-- Phase 4 — "might contain OTC items" review lane.
--
-- The classifier is deliberately narrow: grocery, warehouse-club and general-
-- merchandise MCCs/categories are absent from the medical lists, which is
-- correct — a Costco run is overwhelmingly not a medical expense, and the
-- 2026-08-14 rewrite exists specifically because a looser classifier flagged
-- Dr Pepper and Sharp Electronics. But that narrowness means a real IRS-
-- qualifying item bought alongside groceries (allergy medicine, contact lens
-- solution) is invisible today — the transaction never enters review, so it
-- never gets a chance to be split out.
--
-- This does not touch is_medical for these merchants. It only makes them
-- reviewable, via a new MCC flag the classifier's OTC-lane tier reads
-- (supabase/functions/_shared/medicalClassifier.ts), and widens the review
-- feed to show them as a second, clearly separate lane.

-- ── 1. mcc_codes: a non-medical-but-reviewable class ─────────────────────
ALTER TABLE mcc_codes
  ADD COLUMN IF NOT EXISTS is_reviewable_otc BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN mcc_codes.is_reviewable_otc IS
  'Reclaim Phase 4: when true, this MCC never sets is_medical (no auto-created expense, no total moved) but does queue the transaction for review, since a basket here can still contain an IRS-qualifying item. Mutually exclusive with is_medical.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcc_codes_not_both_medical_and_otc'
  ) THEN
    ALTER TABLE mcc_codes
      ADD CONSTRAINT mcc_codes_not_both_medical_and_otc
      CHECK (NOT (is_medical AND is_reviewable_otc));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcc_codes_is_reviewable_otc
  ON mcc_codes(is_reviewable_otc) WHERE is_reviewable_otc = true;

-- Grocery, warehouse-club and general-merchandise MCCs. None of these are
-- IRS-medical categories on their own — hence is_medical = false — but each
-- is a merchant type that plausibly sells an over-the-counter medical item
-- alongside everything else in the basket.
INSERT INTO mcc_codes (code, description, is_medical, is_reviewable_otc, irs_category, notes) VALUES
  ('5411', 'Grocery Stores, Supermarkets',             false, true, NULL, 'Not medical on its own; OTC medicine/first-aid items sometimes ride along in the basket.'),
  ('5300', 'Wholesale Clubs',                          false, true, NULL, 'Costco, Sam''s Club, BJ''s — same OTC-in-the-basket reasoning as groceries.'),
  ('5310', 'Discount Stores',                          false, true, NULL, 'Target, Walmart discount format.'),
  ('5311', 'Department Stores',                        false, true, NULL, NULL),
  ('5399', 'Miscellaneous General Merchandise',        false, true, NULL, 'Catch-all general-merchandise category; covers some Walmart/Amazon-coded purchases.')
ON CONFLICT (code) DO NOTHING;

-- ── 2. review_feed_groups: a second, clearly separate lane ───────────────
--
-- Same merchant-grouped shape as before, plus:
--   - `lane`: 'medical' (unchanged behavior) or 'possible_otc' (new).
--   - `single_transaction_id`: populated only when the group is exactly one
--     transaction, which is the only case ExpenseSplitDialog can act on
--     unambiguously — splitting requires picking one specific basket, and a
--     group of five different Costco trips has no single basket to split.
--
-- Grouping by (merchant_key, is_medical) rather than merchant_key alone: the
-- same merchant can appear in both lanes (usually medical, occasionally coded
-- as general merchandise), and collapsing those into one row would either
-- lose the distinction or force one lane's explanation onto the other's rows.
--
-- CREATE OR REPLACE cannot add output columns to an existing function — it
-- errors with "cannot change return type of existing function" — so the old
-- signature has to be dropped first.
DROP FUNCTION IF EXISTS public.review_feed_groups(INTEGER);

CREATE FUNCTION public.review_feed_groups(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  merchant_key          TEXT,
  display_name          TEXT,
  txn_count             BIGINT,
  total_amount          NUMERIC,
  earliest_date         DATE,
  latest_date           DATE,
  explanation           TEXT,
  merchant_entity_id    TEXT,
  mcc                   TEXT,
  lane                  TEXT,
  single_transaction_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description))) AS merchant_key,
    (ARRAY_AGG(COALESCE(t.vendor, t.description) ORDER BY t.transaction_date DESC))[1] AS display_name,
    COUNT(*)                AS txn_count,
    SUM(t.amount)           AS total_amount,
    MIN(t.transaction_date) AS earliest_date,
    MAX(t.transaction_date) AS latest_date,
    (ARRAY_AGG(t.classification_explanation ORDER BY t.transaction_date DESC)
       FILTER (WHERE t.classification_explanation IS NOT NULL))[1] AS explanation,
    CASE WHEN COUNT(DISTINCT t.merchant_entity_id) = 1
         THEN MIN(t.merchant_entity_id) END AS merchant_entity_id,
    CASE WHEN COUNT(DISTINCT t.merchant_category_code) = 1
         THEN MIN(t.merchant_category_code) END AS mcc,
    CASE WHEN t.is_medical THEN 'medical' ELSE 'possible_otc' END AS lane,
    -- MIN()/MAX() have no aggregate defined for uuid; ARRAY_AGG works for any
    -- type and, guarded by the COUNT(*) = 1 check, always has exactly one
    -- element when it matters.
    CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(t.id))[1] END AS single_transaction_id
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    AND t.needs_review IS TRUE
    AND (t.is_medical IS TRUE OR t.classification_reason = 'possible_otc')
    AND t.reconciliation_status <> 'ignored'
    AND t.split_parent_id IS NULL
  GROUP BY 1, t.is_medical
  ORDER BY (t.is_medical IS TRUE) DESC, COUNT(*) DESC, SUM(t.amount) DESC
  LIMIT p_limit;
$$;

-- ── 3. bulk_review_merchant: scope by lane so a shared merchant key never
--    straddles both ────────────────────────────────────────────────────────
--
-- A merchant can now appear as two distinct groups (see above). Without a
-- lane filter, deciding one group's "Not medical" button would touch every
-- needs_review row for that merchant key, including rows sitting in the
-- other lane. p_lane defaults to NULL, which preserves the exact old
-- behavior for any caller that does not pass it.
CREATE OR REPLACE FUNCTION public.bulk_review_merchant(
  p_merchant_key TEXT,
  p_is_medical   BOOLEAN,
  p_lane         TEXT DEFAULT NULL
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
        = p_merchant_key
    AND (
      p_lane IS NULL
      OR (p_lane = 'possible_otc' AND t.classification_reason = 'possible_otc')
      OR (p_lane = 'medical' AND t.is_medical IS TRUE)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
