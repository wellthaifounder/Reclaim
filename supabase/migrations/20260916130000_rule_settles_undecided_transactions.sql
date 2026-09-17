-- A categorization rule's "apply to past transactions" checkbox undercounted
-- what it would actually do, discovered 2026-09-16 against a real account:
-- marking "Paramount Accept" not-healthcare and creating a rule from it
-- reported "No past transactions need re-labelling" -- correctly, by
-- 20260911120000's own definition, since every other Paramount Accept charge
-- already had is_medical = false. But that value was never a DECISION -- it
-- was the medical classifier's silent default (classification_reason =
-- 'none', "No medical signal in the merchant name or category"), and it left
-- those transactions permanently looking untouched in the All tab:
-- reconciliation_status stayed 'unlinked', so neither Healthcare nor Not
-- healthcare ever rendered pressed, no matter how many rules existed for that
-- merchant, because the checkbox that would have applied the rule to them was
-- disabled the moment preview reported zero.
--
-- 20260911120000 fixed a real, different problem and that fix stays: it
-- correctly stopped the count from including a transaction that was ALREADY
-- explicitly decided (by the user, or by another rule) and happened to
-- already agree with the new rule -- counting that as "will re-label" is what
-- made the dialog and the toast afterward disagree. What it missed is a third
-- case: a transaction the classifier defaulted on its own, decided by no one.
-- Settling one of those for the first time is exactly what a rule is for,
-- even on the rare merchant where the verdict it lands on happens to match
-- the classifier's guess -- so it now counts too, gated on
-- classification_reason rather than is_medical alone. apply_categorization_
-- rule already swept these rows in as bookkeeping (its targets predicate was
-- never gated on classification_reason to begin with, only on
-- applied_by_rule_id) -- it just never got the chance, since the frontend
-- checkbox that triggers it was disabled by the undercounted preview.
--
-- Separately, and found in the same pass: apply_categorization_rule never set
-- reconciliation_status, the column TransactionCard actually reads to decide
-- whether "Not healthcare" renders pressed. bulk_review_merchant and
-- decide_transactions both set it (`ELSE 'ignored'`); this was the one
-- function in the family that didn't, so even a transaction correctly
-- attributed to a "not healthcare" rule could sit there looking undecided.
-- Fixed to match its siblings. That in turn means revert_categorization_rule
-- needs to be able to put reconciliation_status back the way it found it, so
-- rule_applications gains a column for it -- the same treatment every other
-- field this function touches already gets.

-- ── 1. rule_applications remembers reconciliation_status too ──────────────

ALTER TABLE public.rule_applications
  ADD COLUMN IF NOT EXISTS previous_reconciliation_status TEXT;

-- ── 2. Preview: also count rows no one has actually decided ───────────────

CREATE OR REPLACE FUNCTION public.preview_categorization_rule(
  p_match_type     public.rule_match_type,
  p_match_value    TEXT,
  p_is_medical     BOOLEAN DEFAULT NULL,
  p_match_operator public.rule_name_operator DEFAULT 'starts_with'
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    AND public.transaction_matches_rule(
          p_match_type, p_match_value,
          t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized,
          p_match_operator
        )
    AND (
      p_is_medical IS NULL
      OR t.is_medical IS DISTINCT FROM p_is_medical
      -- Never explicitly decided by a person or a rule -- an algorithmic
      -- default ('none', 'mcc', 'personal_finance_category', 'keyword',
      -- 'possible_otc', 'excluded', ...), however it happens to land, still
      -- needs settling once.
      OR t.classification_reason NOT IN ('user', 'rule')
    );
$$;

COMMENT ON FUNCTION public.preview_categorization_rule(public.rule_match_type, TEXT, BOOLEAN, public.rule_name_operator) IS
  'How many of the user''s transactions this rule would actually settle -- either flip their verdict, or decide them for the first time if the classifier only ever guessed. Rows already explicitly decided (by a person or another rule) to this same verdict are excluded.';

-- ── 3. Apply: set reconciliation_status, count the same rows preview did ──

CREATE OR REPLACE FUNCTION public.apply_categorization_rule(p_rule_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule    public.categorization_rules%ROWTYPE;
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_rule
  FROM public.categorization_rules
  WHERE id = p_rule_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found' USING ERRCODE = 'no_data_found';
  END IF;

  WITH targets AS (
    SELECT t.id, t.is_medical, t.needs_review,
           t.classification_reason, t.classification_explanation,
           t.applied_by_rule_id, t.reconciliation_status
    FROM public.transactions t
    WHERE t.user_id = v_user_id
      AND public.transaction_matches_rule(
            v_rule.match_type, v_rule.match_value,
            t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized,
            v_rule.match_operator
          )
      -- Skip rows this rule already governs; re-applying is a no-op, not a
      -- second log entry.
      AND (t.applied_by_rule_id IS DISTINCT FROM p_rule_id
           OR t.is_medical IS DISTINCT FROM v_rule.is_medical)
    FOR UPDATE
  ), logged AS (
    INSERT INTO public.rule_applications (
      rule_id, transaction_id, user_id,
      previous_is_medical, previous_needs_review,
      previous_classification_reason, previous_classification_explanation,
      previous_applied_by_rule_id, previous_reconciliation_status
    )
    SELECT p_rule_id, targets.id, v_user_id,
           targets.is_medical, targets.needs_review,
           targets.classification_reason, targets.classification_explanation,
           targets.applied_by_rule_id, targets.reconciliation_status
    FROM targets
    RETURNING transaction_id, previous_is_medical, previous_classification_reason
  ), updated AS (
    UPDATE public.transactions t
    SET is_medical = v_rule.is_medical,
        needs_review = FALSE,
        category = CASE WHEN v_rule.is_medical THEN 'medical' ELSE t.category END,
        -- Matches bulk_review_merchant / decide_transactions: a "not
        -- healthcare" verdict retires the transaction from reconciliation the
        -- same way regardless of who or what made the call. Missing here
        -- before now, which is why a rule-settled transaction could carry the
        -- right verdict and still look untouched in the All tab -- neither
        -- button renders pressed off is_medical alone.
        reconciliation_status = CASE
          WHEN v_rule.is_medical THEN t.reconciliation_status ELSE 'ignored' END,
        applied_by_rule_id = p_rule_id,
        classification_reason = 'rule',
        classification_explanation = format(
          'Rule: %s is %s.',
          COALESCE(v_rule.display_label, v_rule.match_value),
          CASE WHEN v_rule.is_medical THEN 'medical' ELSE 'not medical' END
        ),
        classification_confidence = 1.0,
        updated_at = now()
    FROM logged
    WHERE t.id = logged.transaction_id
    RETURNING logged.previous_is_medical AS was_medical,
              logged.previous_classification_reason AS was_reason
  )
  -- Mirrors preview_categorization_rule's promise, so the toast afterward
  -- ("N past transactions updated") never disagrees with what the dialog
  -- said before: count a row if its verdict flipped, or if it was never
  -- explicitly decided before now. A row that was already explicitly
  -- decided (by a person or another rule) to this same verdict is still
  -- touched above -- reattributed for undo -- but not counted here.
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM updated
  WHERE was_medical IS DISTINCT FROM v_rule.is_medical
     OR was_reason NOT IN ('user', 'rule');

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.apply_categorization_rule(UUID) IS
  'Applies a rule to existing transactions and returns how many it actually settled -- a verdict flip, or a first real decision on a row the classifier only ever guessed at. Rows already explicitly decided to this same verdict are still updated (attributed to the rule, and logged so undo can restore them) but are not counted, so this matches what preview_categorization_rule promised.';

-- ── 4. Undo restores reconciliation_status too ─────────────────────────────

CREATE OR REPLACE FUNCTION public.revert_categorization_rule(p_rule_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.categorization_rules
    WHERE id = p_rule_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Rule not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Newest application per transaction wins: if a rule was applied, reverted
  -- and applied again, the most recent pre-change state is the correct one to
  -- restore.
  WITH latest AS (
    SELECT DISTINCT ON (ra.transaction_id)
           ra.id, ra.transaction_id,
           ra.previous_is_medical, ra.previous_needs_review,
           ra.previous_classification_reason, ra.previous_classification_explanation,
           ra.previous_applied_by_rule_id, ra.previous_reconciliation_status
    FROM public.rule_applications ra
    WHERE ra.rule_id = p_rule_id
      AND ra.user_id = v_user_id
      AND ra.reverted_at IS NULL
    ORDER BY ra.transaction_id, ra.applied_at DESC
  ), restored AS (
    UPDATE public.transactions t
    SET is_medical = latest.previous_is_medical,
        needs_review = latest.previous_needs_review,
        classification_reason = latest.previous_classification_reason,
        classification_explanation = latest.previous_classification_explanation,
        applied_by_rule_id = latest.previous_applied_by_rule_id,
        -- Rows logged before this migration have no recorded prior value
        -- (column just added, backfilled NULL) -- leave reconciliation_status
        -- as it is rather than null it out, which would silently un-ignore a
        -- transaction the user never asked to revisit.
        reconciliation_status = COALESCE(
          latest.previous_reconciliation_status, t.reconciliation_status
        ),
        updated_at = now()
    FROM latest
    WHERE t.id = latest.transaction_id
      AND t.user_id = v_user_id
    RETURNING latest.id AS application_id
  )
  UPDATE public.rule_applications ra
  SET reverted_at = now()
  FROM restored
  WHERE ra.id = restored.application_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
