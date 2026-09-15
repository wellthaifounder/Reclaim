-- docs/TRANSACTION_REVIEW_SPEC.md D22/D23 — name-matching rules gain three
-- operators: is exactly / starts with / contains.
--
-- Today a name_pattern rule has exactly one behaviour: a word-boundary
-- prefix match (`normalize_merchant_name(...) = value OR ... LIKE value ||
-- ' %'`). That catches "walgreens store" for a "walgreens" rule but can
-- never reach a healthcare billing middleman that puts its own name first
-- -- `ATHENAHEALTH*SMITH FAMILY MED` -- where the practice the user
-- recognises is buried mid-string. "Contains" exists for exactly that case,
-- at the cost of also matching things nobody meant (D23: "Contains: med
-- matches Mediterranean Grill and Medina Bakery" -- deliberately not fixed
-- by a smarter boundary rule, since the whole point of "contains" is the
-- raw substring; the preview-names function below is what lets a user see
-- that danger before committing to it).
--
-- New rows and the app's own suggested rule still default to starts_with --
-- today's only behaviour -- so nothing already relying on that default
-- changes shape.
--
-- transaction_matches_rule's signature is changing (a 6th parameter), so it
-- is dropped and recreated rather than CREATE OR REPLACE-d: Postgres treats
-- an added parameter as a new overload, not a replacement, and a 5-argument
-- call becomes ambiguous once both exist. Same for preview_categorization_
-- rule. apply_categorization_rule's own signature (just a UUID) is
-- unchanged, so it stays a plain CREATE OR REPLACE -- only its body, which
-- calls transaction_matches_rule, needs to pass the new argument through.

-- ── 1. The operator enum and column ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rule_name_operator') THEN
    CREATE TYPE public.rule_name_operator AS ENUM (
      'is_exactly',
      'starts_with',
      'contains'
    );
  END IF;
END
$$;

-- Meaningful only for match_type = 'name_pattern'; entity and mcc rules
-- always match on exact equality of that single signal, so the column sits
-- unused (at its default) on those rows rather than being nullable and
-- needing a "does this row even have an operator" check everywhere it's read.
ALTER TABLE public.categorization_rules
  ADD COLUMN IF NOT EXISTS match_operator public.rule_name_operator
    NOT NULL DEFAULT 'starts_with';

-- ── 2. The matching predicate gains the operator ───────────────────────────

DROP FUNCTION IF EXISTS public.transaction_matches_rule(
  public.rule_match_type, TEXT, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.transaction_matches_rule(
  p_match_type public.rule_match_type,
  p_match_value TEXT,
  p_merchant_entity_id TEXT,
  p_merchant_category_code TEXT,
  p_merchant_normalized TEXT,
  p_match_operator public.rule_name_operator DEFAULT 'starts_with'
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_match_type
    WHEN 'merchant_entity' THEN p_merchant_entity_id IS NOT DISTINCT FROM p_match_value
    WHEN 'mcc'             THEN p_merchant_category_code IS NOT DISTINCT FROM p_match_value
    WHEN 'name_pattern'    THEN
      p_merchant_normalized IS NOT NULL
      AND p_match_value IS NOT NULL
      AND (
        CASE p_match_operator
          WHEN 'is_exactly' THEN
            p_merchant_normalized = p_match_value
          WHEN 'contains' THEN
            -- p_match_value is itself the output of normalize_merchant_name,
            -- which collapses every non-alphanumeric character (including
            -- LIKE's own % and _ wildcards) to a plain space, so it can never
            -- carry a literal wildcard here -- no ESCAPE clause needed.
            p_merchant_normalized LIKE '%' || p_match_value || '%'
          ELSE -- 'starts_with', and the default for a NULL/unrecognised value
            p_merchant_normalized = p_match_value
            OR p_merchant_normalized LIKE p_match_value || ' %'
        END
      )
  END;
$$;

-- ── 3. Preview: how many transactions would this rule touch ───────────────
-- Same drop-and-recreate reasoning as above. p_match_operator defaults to
-- 'starts_with' so a frontend deployed moments before this migration lands
-- (still calling the 3-argument shape) keeps working during the rollout
-- window.

DROP FUNCTION IF EXISTS public.preview_categorization_rule(
  public.rule_match_type, TEXT, BOOLEAN
);

CREATE FUNCTION public.preview_categorization_rule(
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
    AND (p_is_medical IS NULL OR t.is_medical IS DISTINCT FROM p_is_medical);
$$;

COMMENT ON FUNCTION public.preview_categorization_rule(public.rule_match_type, TEXT, BOOLEAN, public.rule_name_operator) IS
  'How many of the user''s transactions this rule would actually re-label. Pass the rule''s verdict as p_is_medical; rows that already agree are excluded.';

-- ── 4. D23: up to five actual merchant names a rule would catch ───────────
-- A count cannot warn you that "contains: med" catches Mediterranean Grill
-- and Medina Bakery; a list of names can. Generic over all three operators
-- (useful for any of them), but the UI only surfaces it for 'contains',
-- where a raw substring match is the one genuinely capable of a surprise.

CREATE OR REPLACE FUNCTION public.preview_categorization_rule_names(
  p_match_type     public.rule_match_type,
  p_match_value    TEXT,
  p_match_operator public.rule_name_operator DEFAULT 'starts_with',
  p_limit          INTEGER DEFAULT 5
)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(ARRAY_AGG(name), '{}')
  FROM (
    SELECT DISTINCT COALESCE(t.vendor, t.description) AS name
    FROM public.transactions t
    WHERE t.user_id = auth.uid()
      AND public.transaction_matches_rule(
            p_match_type, p_match_value,
            t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized,
            p_match_operator
          )
      AND COALESCE(t.vendor, t.description) IS NOT NULL
    ORDER BY COALESCE(t.vendor, t.description)
    LIMIT p_limit
  ) names;
$$;

COMMENT ON FUNCTION public.preview_categorization_rule_names(public.rule_match_type, TEXT, public.rule_name_operator, INTEGER) IS
  'Up to p_limit distinct merchant names (as the user would recognise them) that this rule would match, for spec D23''s contains-operator warning.';

-- ── 5. apply_categorization_rule reads the rule's own stored operator ─────
-- Signature (just a UUID) is unchanged, so this stays CREATE OR REPLACE;
-- only the call to transaction_matches_rule inside needs the new argument.

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
           t.applied_by_rule_id
    FROM public.transactions t
    WHERE t.user_id = v_user_id
      AND public.transaction_matches_rule(
            v_rule.match_type, v_rule.match_value,
            t.merchant_entity_id, t.merchant_category_code, t.merchant_normalized,
            v_rule.match_operator
          )
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
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM updated
  WHERE was_medical IS DISTINCT FROM v_rule.is_medical;

  RETURN v_count;
END;
$$;
