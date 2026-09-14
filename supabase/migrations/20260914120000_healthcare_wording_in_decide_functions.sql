-- docs/TRANSACTION_REVIEW_SPEC.md B2 — "medical" retired from user-facing copy.
--
-- The frontend wording pass (ReviewFeed, TransactionCard, BulkDecideBar,
-- CreateRulePrompt, ExpenseSplitDialog) swapped every button, toast and
-- dialog sentence a user reads from "medical" to "healthcare". These two
-- functions write a THIRD piece of copy the user reads later: the
-- classification_explanation stamped onto a transaction the moment it is
-- confirmed or dismissed, which resurfaces as the "why" line under a row
-- (TransactionCard's classificationExplanation, a review group's
-- `explanation`) for as long as that transaction is browsed afterwards.
-- Leaving it unchanged would have meant every button on the page said
-- "Healthcare" while the sentence explaining the decision you just made
-- still said "medical" -- the exact same inconsistency this wording pass
-- exists to remove, just one layer down.
--
-- CREATE OR REPLACE only, no schema change: both functions are copied
-- verbatim from their current definition (20260906120000_approval_creates_
-- expense.sql) with nothing touched but the two literal strings inside
-- classification_explanation. `category`'s stored value stays 'medical' --
-- that is data (filtered on elsewhere), not copy, and changing it is a
-- separate, bigger decision than a wording pass.

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
      OR (p_lane = 'possible_otc' AND t.classification_reason = 'possible_otc')
      OR (p_lane = 'medical' AND t.classification_reason IS DISTINCT FROM 'possible_otc')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_transactions(
  p_transaction_ids UUID[],
  p_is_medical      BOOLEAN
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

  IF p_transaction_ids IS NULL OR array_length(p_transaction_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.transactions t
  SET is_medical = p_is_medical,
      needs_review = FALSE,
      category = CASE WHEN p_is_medical THEN 'medical' ELSE t.category END,
      -- Marking something not medical files it away; confirming it medical
      -- leaves reconciliation to the expense trigger, which sets
      -- 'linked_to_invoice'.
      reconciliation_status = CASE
        WHEN p_is_medical THEN t.reconciliation_status ELSE 'ignored' END,
      classification_reason = 'user',
      classification_explanation = CASE
        WHEN p_is_medical THEN 'You confirmed this as a healthcare expense.'
        ELSE 'You said this wasn''t healthcare.' END,
      classification_confidence = 1.0,
      updated_at = now()
  WHERE t.user_id = v_user_id
    AND t.id = ANY(p_transaction_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
