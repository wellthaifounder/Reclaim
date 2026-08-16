-- Workstream C4 — review feed.
--
-- Three things:
--   1. Fix the confirm_match trigger, which has never fired in production.
--   2. Group the review queue by merchant so one decision clears many rows.
--   3. Bulk-decide a merchant's *unreviewed* transactions only.

-- ── 1. The dead confirm_match trigger ─────────────────────────────────────
--
-- transaction_invoice_suggestions.confidence_score is CHECKed to 0..100
-- (20251022024856) and plaid-sync-transactions writes
-- Math.round(confidence * 100), so the stored value is an integer percentage.
-- The trigger compared it against 0.7 and 0.9 — a 0..1 scale. No integer lies
-- in [0.7, 0.9), so the condition was unsatisfiable and the confirm_match
-- inbox item has never been produced for any user.
--
-- Verified 2026-08-15: inserting a suggestion at confidence_score = 85
-- generated 0 inbox items.
--
-- Thresholds restated on the column's actual scale. Below 70 is too weak to
-- bother the user with; 90 and above is confident enough to auto-link
-- elsewhere, so the confirmation band is [70, 90).

CREATE OR REPLACE FUNCTION public.generate_match_inbox_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID;
  v_txn_vendor TEXT;
  v_txn_amount NUMERIC;
  v_inv_vendor TEXT;
BEGIN
  IF NEW.confidence_score >= 70 AND NEW.confidence_score < 90 THEN
    SELECT t.user_id, COALESCE(t.vendor, t.description), t.amount
      INTO v_user_id, v_txn_vendor, v_txn_amount
      FROM public.transactions t WHERE t.id = NEW.transaction_id;

    SELECT i.vendor INTO v_inv_vendor
      FROM public.invoices i WHERE i.id = NEW.invoice_id;

    -- A suggestion whose transaction or invoice has since been deleted has
    -- nothing to confirm. The old version would have inserted a row with a
    -- null user_id and violated NOT NULL.
    IF v_user_id IS NULL OR v_inv_vendor IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.inbox_items (
      user_id, item_type, source_entity_id, source_entity_type,
      title, subtitle, amount, suggested_action, priority_score
    )
    VALUES (
      v_user_id,
      'confirm_match',
      NEW.id,
      'transaction_invoice_suggestion',
      v_txn_vendor || ' → ' || v_inv_vendor,
      'Suggested match (' || ROUND(NEW.confidence_score) || '% confidence)',
      v_txn_amount,
      jsonb_build_object(
        'action', 'link',
        'transaction_id', NEW.transaction_id,
        'invoice_id', NEW.invoice_id,
        'confidence', NEW.confidence_score
      ),
      80
    )
    ON CONFLICT (user_id, source_entity_id, item_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Merchant-grouped review feed ───────────────────────────────────────
--
-- Spec: "Merchant-grouped bulk review: '18 transactions from Walgreens —
-- medical?'". Counts have to span the whole queue, not just the page on
-- screen, so the grouping is an aggregate rather than a client-side reduce.
--
-- Scope is deliberately likely-medical only. Non-medical transactions are
-- auto-decided and silent — the user never reviews Netflix.

CREATE OR REPLACE FUNCTION public.review_feed_groups(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  merchant_key       TEXT,
  display_name       TEXT,
  txn_count          BIGINT,
  total_amount       NUMERIC,
  earliest_date      DATE,
  latest_date        DATE,
  explanation        TEXT,
  merchant_entity_id TEXT,
  mcc                TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description))) AS merchant_key,
    -- The prettiest real descriptor in the group, not the normalized key.
    (ARRAY_AGG(COALESCE(t.vendor, t.description) ORDER BY t.transaction_date DESC))[1] AS display_name,
    COUNT(*)                AS txn_count,
    SUM(t.amount)           AS total_amount,
    MIN(t.transaction_date) AS earliest_date,
    MAX(t.transaction_date) AS latest_date,
    (ARRAY_AGG(t.classification_explanation ORDER BY t.transaction_date DESC)
       FILTER (WHERE t.classification_explanation IS NOT NULL))[1] AS explanation,
    -- Only expose a rule key when the whole group agrees on it; a key that
    -- holds for some rows would make a rule that silently misses the others.
    CASE WHEN COUNT(DISTINCT t.merchant_entity_id) = 1
         THEN MIN(t.merchant_entity_id) END AS merchant_entity_id,
    CASE WHEN COUNT(DISTINCT t.merchant_category_code) = 1
         THEN MIN(t.merchant_category_code) END AS mcc
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    AND t.needs_review IS TRUE
    AND t.is_medical IS TRUE
    AND t.reconciliation_status <> 'ignored'
    AND t.split_parent_id IS NULL
  GROUP BY 1
  ORDER BY COUNT(*) DESC, SUM(t.amount) DESC
  LIMIT p_limit;
$$;

-- ── 3. Bulk-decide one merchant ───────────────────────────────────────────
--
-- Touches ONLY transactions still awaiting review. Deciding something the
-- user put in the queue is the whole point of the queue; silently revising
-- decisions they already made is not, and that is what rules and their
-- explicit Apply button are for.

CREATE OR REPLACE FUNCTION public.bulk_review_merchant(
  p_merchant_key TEXT,
  p_is_medical   BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.transactions t
  SET is_medical = p_is_medical,
      needs_review = FALSE,
      category = CASE WHEN p_is_medical THEN 'medical' ELSE t.category END,
      reconciliation_status = CASE
        WHEN p_is_medical THEN t.reconciliation_status ELSE 'ignored' END,
      classification_reason = 'user',
      classification_explanation = CASE
        WHEN p_is_medical THEN 'You confirmed this as a medical expense.'
        ELSE 'You marked this as not medical.' END,
      classification_confidence = 1.0,
      updated_at = now()
  WHERE t.user_id = v_user_id
    AND t.needs_review IS TRUE
    AND COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description)))
        = p_merchant_key;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Serves both the review feed aggregate and the bulk update.
CREATE INDEX IF NOT EXISTS idx_transactions_needs_review
  ON public.transactions (user_id, merchant_normalized)
  WHERE needs_review IS TRUE;
