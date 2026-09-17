-- docs/TRANSACTION_REVIEW_SPEC.md §2.9, D36–D41 — slice 1, the model change.
--
-- The classifier itself (supabase/functions/_shared/medicalClassifier.ts)
-- stops filing charges it cannot defend an answer about; they arrive in the
-- review queue with needs_review = TRUE, is_medical = FALSE and
-- classification_reason = 'uncertain'. This migration is everything in the
-- database that has to be true for those rows to land somewhere sensible.
--
-- THE ORDERING HAZARD THIS FIXES FIRST. review_feed_groups derives the lane
-- from `classification_reason = 'possible_otc'`, so an 'uncertain' row would
-- land in the *medical* lane — the app telling the user it is confident a
-- charge is healthcare precisely when it has just admitted it has no idea.
-- That is why the classifier change and this migration cannot ship apart.
--
-- Lane VALUES are deliberately left as 'medical' / 'possible_otc' even though
-- the second no longer means over-the-counter. Migrations reach production
-- before the frontend that reads them (CLAUDE.md), so renaming the wire value
-- would empty that lane on screen for the length of a Vercel deploy. The
-- values are internal; the heading the user reads is frontend copy and
-- changes there. Rename them in a later slice if it ever earns its own PR.

-- ── 1. Which engine last looked at this row (D40) ─────────────────────────
-- NULL means "classified before 2026-09-17", which is what the re-classify
-- pass looks for. Deliberately not defaulted or backfilled: a default would
-- claim every historical row had already been seen by the new engine, which
-- is the exact lie that left 51 charges invisible on a real account.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS classifier_version SMALLINT;

COMMENT ON COLUMN public.transactions.classifier_version IS
  'Version of medicalClassifier.ts that last decided this row. NULL = pre-2026-09-17. The reclassify-transactions function re-examines rows below the current version, never rows a person or a rule decided.';

CREATE INDEX IF NOT EXISTS idx_transactions_classifier_version
  ON public.transactions (user_id, classifier_version)
  WHERE classification_reason NOT IN ('user', 'rule');

-- ── 2. The queue's second lane holds everything uncertain (D41) ───────────
-- Lane now derives from is_medical: did the engine claim this IS healthcare,
-- or is it merely asking? That covers 'possible_otc' and 'uncertain' with one
-- rule, which is the point — to the user they are the same sentence.
--
-- Note this is also what review_feed_group_transactions has always done (see
-- its own comment, which described review_feed_groups as is_medical-based
-- before that was true). The two agree again now, by construction.
--
-- Lane ordering flips from DESC to ASC. 'possible_otc' sorts after 'medical',
-- so DESC put the uncertain lane first — harmless while it held a handful of
-- grocery runs, and actively dangerous now that it holds every unknown: with
-- LIMIT 75 and enough unknowns, the healthcare lane would be truncated away
-- entirely and the user would never see the charges most likely to be worth
-- money. Highest-value work survives truncation; that is D10's whole premise.

CREATE OR REPLACE FUNCTION public.review_feed_groups(p_limit INTEGER DEFAULT 50)
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
    CASE WHEN t.is_medical IS TRUE THEN 'medical' ELSE 'possible_otc' END AS lane,
    -- MIN()/MAX() have no aggregate defined for uuid; ARRAY_AGG works for any
    -- type and, guarded by the COUNT(*) = 1 check, always has exactly one
    -- element when it matters.
    CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(t.id))[1] END AS single_transaction_id
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    AND t.needs_review IS TRUE
    -- COALESCE, not `<> 'ignored'`: a NULL status makes that comparison NULL,
    -- which drops the row from the queue while the badge still counts it.
    AND COALESCE(t.reconciliation_status, '') <> 'ignored'
    AND t.split_parent_id IS NULL
  GROUP BY 1, (CASE WHEN t.is_medical IS TRUE THEN 'medical' ELSE 'possible_otc' END)
  ORDER BY (CASE WHEN t.is_medical IS TRUE THEN 'medical' ELSE 'possible_otc' END) ASC,
           SUM(t.amount) DESC, COUNT(*) DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.review_feed_groups(INTEGER) IS
  'The review queue, grouped by merchant. Two lanes, derived from is_medical: charges the engine believes are healthcare (awaiting approval), and everything it is merely asking about — baskets and unknowns alike (spec D41). Ordered highest-dollars-first within a lane, healthcare lane first so truncation never hides the most valuable work.';

-- ── 3. An expanded group contains exactly what its row counted ────────────
-- One change: the `(is_medical IS TRUE OR classification_reason =
-- 'possible_otc')` filter is dropped. It predates 'uncertain' and would have
-- rendered an empty list under every unknown-merchant group — a group row
-- saying "3 transactions" that opens onto nothing.

CREATE OR REPLACE FUNCTION public.review_feed_group_transactions(
  p_merchant_key TEXT,
  p_lane         TEXT DEFAULT NULL,
  p_limit        INTEGER DEFAULT 200
)
RETURNS TABLE (
  id                         UUID,
  transaction_date           DATE,
  amount                     NUMERIC,
  vendor                     TEXT,
  description                TEXT,
  category                   TEXT,
  classification_explanation TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.amount,
    t.vendor,
    t.description,
    t.category,
    t.classification_explanation
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    -- Everything from here to the lane filter is copied verbatim from
    -- review_feed_groups' WHERE clause. It has to be: this function answers
    -- "what is inside that row", so any difference is a bug by construction.
    AND t.needs_review IS TRUE
    AND COALESCE(t.reconciliation_status, '') <> 'ignored'
    AND t.split_parent_id IS NULL
    AND COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description)))
        = p_merchant_key
    -- Mirrors review_feed_groups' lane derivation exactly.
    AND (
      p_lane IS NULL
      OR (p_lane = 'medical'      AND t.is_medical IS TRUE)
      OR (p_lane = 'possible_otc' AND t.is_medical IS NOT TRUE)
    )
  ORDER BY t.transaction_date DESC, t.id
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.review_feed_group_transactions(TEXT, TEXT, INTEGER) IS
  'The individual transactions behind one review_feed_groups row. Shares that function''s WHERE clause and lane derivation verbatim so an expanded group always contains exactly what the group row counted. SECURITY INVOKER: RLS on transactions plus the auth.uid() filter scope it to the caller.';

-- ── 4. A bulk decision touches exactly the lane it was clicked in ─────────
-- Same correction, and the one with teeth: this function WRITES. Its lane
-- filter was spelled `classification_reason = 'possible_otc'`, which was
-- equivalent to the grouping only while the queue held nothing else. Left
-- alone, "none of these had healthcare items" on an unknown-merchant group
-- would have matched the 'medical' branch and swept rows the user was not
-- looking at. Copied verbatim from 20260914120000 with only that filter
-- changed.

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
        WHEN p_is_medical THEN 'You confirmed this as a healthcare expense.'
        ELSE 'You said this wasn''t healthcare.' END,
      classification_confidence = 1.0,
      updated_at = now()
  WHERE t.user_id = v_user_id
    AND t.needs_review IS TRUE
    AND COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description)))
        = p_merchant_key
    AND (
      p_lane IS NULL
      OR (p_lane = 'medical'      AND t.is_medical IS TRUE)
      OR (p_lane = 'possible_otc' AND t.is_medical IS NOT TRUE)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.bulk_review_merchant(TEXT, BOOLEAN, TEXT) IS
  'Decides every still-unreviewed transaction for one merchant within one lane. Lane filter mirrors review_feed_groups'' is_medical derivation, so a bulk click can only ever touch the rows the user was actually looking at.';
