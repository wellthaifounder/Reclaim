-- Count what the rule would actually re-label, not how many transactions the
-- merchant has.
--
-- THE BUG. preview_categorization_rule() counted every transaction matching the
-- merchant, with no reference to what the rule would DO to them. Two
-- consequences, both reproduced against a real database on 2026-09-11:
--
--   1. It counted the transaction the user had just categorized. Marking a
--      single Lenscrafters charge as medical produced "Also re-label 1 past
--      transaction" -- that one. Applying it rewrote the row to the verdict it
--      already had: is_medical stayed true, only classification_reason moved
--      from 'user' to 'rule'. Nothing was re-labelled, and the checkbox's
--      warning ("This changes transactions you have already categorized")
--      described a change the user could not see.
--
--   2. It counted transactions that already agreed with the rule. Three
--      Lenscrafters charges -- one just decided, one already medical, one still
--      marked not-medical -- produced "re-label 3 past transactions" when
--      exactly 1 would change.
--
-- The dialog exists to show the blast radius before the user agrees to it, so
-- the number has to be the blast radius: rows whose medical verdict flips.
--
-- WHY apply_categorization_rule STILL TOUCHES THE OTHERS. Rows that already
-- agree are updated anyway, to attribute them to the rule and let undo restore
-- what they were. That is bookkeeping, not a re-labelling, so it is no longer
-- what the function REPORTS -- otherwise the toast afterwards contradicts the
-- number in the dialog before.

-- ── 1. Preview: count only the rows that would flip ───────────────────────
-- Dropped and recreated rather than replaced, because the parameter list
-- changes. p_is_medical defaults to NULL, which reproduces the old
-- count-everything behaviour -- so two-argument calls from the frontend that is
-- live while this migration is applied keep working until the new code ships.

DROP FUNCTION IF EXISTS public.preview_categorization_rule(public.rule_match_type, TEXT);

CREATE FUNCTION public.preview_categorization_rule(
  p_match_type  public.rule_match_type,
  p_match_value TEXT,
  p_is_medical  BOOLEAN DEFAULT NULL
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
          t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized
        )
    -- NULL = "how many does this merchant have", the old question, kept only
    -- for the deploy window. A verdict = "how many would this rule change".
    AND (p_is_medical IS NULL OR t.is_medical IS DISTINCT FROM p_is_medical);
$$;

COMMENT ON FUNCTION public.preview_categorization_rule(public.rule_match_type, TEXT, BOOLEAN) IS
  'How many of the user''s transactions this rule would actually re-label. Pass the rule''s verdict as p_is_medical; rows that already agree are excluded, which is what keeps the transaction the user just categorized out of its own "past transactions" count.';

-- ── 2. Apply: report the same measure the preview promised ────────────────
-- Body is the 20260815120000 original with one change: the returned count is
-- now the number of rows whose verdict changed, rather than ROW_COUNT over
-- every row touched.

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

  -- Log the pre-change state first, so undo has something to restore even if
  -- the caller's transaction is inspected mid-flight.
  WITH targets AS (
    SELECT t.id, t.is_medical, t.needs_review,
           t.classification_reason, t.classification_explanation,
           t.applied_by_rule_id
    FROM public.transactions t
    WHERE t.user_id = v_user_id
      AND public.transaction_matches_rule(
            v_rule.match_type, v_rule.match_value,
            t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized
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
      previous_applied_by_rule_id
    )
    SELECT p_rule_id, targets.id, v_user_id,
           targets.is_medical, targets.needs_review,
           targets.classification_reason, targets.classification_explanation,
           targets.applied_by_rule_id
    FROM targets
    RETURNING transaction_id, previous_is_medical
  ), updated AS (
    UPDATE public.transactions t
    SET is_medical = v_rule.is_medical,
        -- A rule is an explicit user decision, so the row leaves the review
        -- queue outright.
        needs_review = FALSE,
        category = CASE WHEN v_rule.is_medical THEN 'medical' ELSE t.category END,
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
    RETURNING logged.previous_is_medical AS was_medical
  )
  -- The reported number is re-labellings, not rows touched. A row that already
  -- carried this verdict was only re-attributed to the rule, and telling the
  -- user it was "updated" is what made the dialog's promise and the toast
  -- afterwards disagree.
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM updated
  WHERE was_medical IS DISTINCT FROM v_rule.is_medical;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.apply_categorization_rule(UUID) IS
  'Applies a rule to existing transactions and returns how many actually changed their medical verdict. Rows that already agreed are still updated (attributed to the rule, and logged so undo can restore them) but are not counted, so this matches what preview_categorization_rule promised.';
