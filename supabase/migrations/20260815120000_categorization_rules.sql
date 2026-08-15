-- Workstream C3 — categorization rules with a precedence chain, retroactive
-- apply, and undo.
--
-- Prerequisite fixed here as well: the merchant signals a rule keys on were
-- never persisted. plaidSync.ts reads merchant_category_code and
-- personal_finance_category off the Plaid payload, passes them to the
-- classifier, and then throws them away — only the boolean verdict was stored.
-- That makes retroactive apply impossible for anything but a name match, and
-- leaves the "why was this categorized?" chip with nothing to render. So this
-- migration persists the signals and the classification provenance first, then
-- builds the rules engine on top of them.
--
-- Precedence (first match wins, matching the classifier's tier order):
--   1. merchant_entity  — Plaid's stable merchant id. Most precise, but the
--                         2026-08-14 sandbox probe measured it on only ~44% of
--                         transactions, so it cannot be the sole key.
--   2. mcc              — merchant category code. ~60% coverage.
--   3. name_pattern     — normalized merchant name. Always available; last
--                         resort because raw descriptors vary wildly
--                         ("SQ *DR SMITH", "TST* CAFE").

-- ── 1. Persist the merchant signals and classification provenance ──────────

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS merchant_category_code TEXT,
  ADD COLUMN IF NOT EXISTS pfc_primary TEXT,
  ADD COLUMN IF NOT EXISTS pfc_detailed TEXT,
  ADD COLUMN IF NOT EXISTS pfc_confidence TEXT,
  ADD COLUMN IF NOT EXISTS classification_reason TEXT,
  ADD COLUMN IF NOT EXISTS classification_explanation TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC;

COMMENT ON COLUMN public.transactions.merchant_entity_id IS
  'Plaid merchant_entity_id. Stable across descriptor changes; ~44% coverage.';
COMMENT ON COLUMN public.transactions.classification_explanation IS
  'Plain-language reason shown to the user as the "why" chip. Never PHI — it
   describes the merchant category, not the care received.';

-- ── 2. Merchant-name normalization ────────────────────────────────────────
-- Both this function and its TypeScript twin in src/lib/merchantNormalize.ts
-- must produce identical output: rules are stored normalized, and a rule
-- created in the browser has to match rows normalized in the database.
--
-- IMMUTABLE is required for the generated column below. Everything here is a
-- pure string transform, so that holds.

CREATE OR REPLACE FUNCTION public.normalize_merchant_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    BTRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            LOWER(COALESCE(p_name, '')),
            -- Payment-processor prefixes: "SQ *", "TST* ", "PAYPAL *", "SP ".
            '^(sq|tst|sp|pp|paypal|pos|ach|dd|ext|py|chk)\s*\*+\s*',
            ''
          ),
          -- Trailing store/reference numbers and dangling punctuation:
          -- "walgreens #4821", "cvs/pharmacy 03412".
          '\s*[#*]?\s*\d{3,}\s*$',
          ''
        ),
        -- Collapse any remaining non-alphanumerics to single spaces.
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

-- Indexed, so a name-pattern rule does not table-scan on retroactive apply.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_normalized TEXT
  GENERATED ALWAYS AS (
    public.normalize_merchant_name(COALESCE(vendor, description))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_transactions_merchant_normalized
  ON public.transactions (user_id, merchant_normalized)
  WHERE merchant_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_merchant_entity
  ON public.transactions (user_id, merchant_entity_id)
  WHERE merchant_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_mcc
  ON public.transactions (user_id, merchant_category_code)
  WHERE merchant_category_code IS NOT NULL;

-- ── 3. The rules table ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rule_match_type') THEN
    CREATE TYPE public.rule_match_type AS ENUM (
      'merchant_entity',
      'mcc',
      'name_pattern'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.categorization_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_type public.rule_match_type NOT NULL,
  -- Stored already-normalized for name_pattern; verbatim for the other two.
  match_value TEXT NOT NULL CHECK (BTRIM(match_value) <> ''),
  is_medical BOOLEAN NOT NULL,
  -- What to show in the rules list. For a name_pattern rule the match_value is
  -- normalized and ugly ("walgreens"), so keep the merchant name the user
  -- actually saw when they created it.
  display_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_type, match_value)
);

ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own categorization rules"
  ON public.categorization_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own categorization rules"
  ON public.categorization_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own categorization rules"
  ON public.categorization_rules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own categorization rules"
  ON public.categorization_rules FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_categorization_rules_updated_at
  BEFORE UPDATE ON public.categorization_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_categorization_rules_user
  ON public.categorization_rules (user_id, match_type);

-- ── 4. Application log — provenance and undo ──────────────────────────────
-- Storing the previous values is what makes undo real. Without it, reverting a
-- rule could only guess at what the transaction looked like before, and a
-- second rule applied on top of a first would be unrecoverable.

CREATE TABLE IF NOT EXISTS public.rule_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES public.categorization_rules(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_is_medical BOOLEAN,
  previous_needs_review BOOLEAN,
  previous_classification_reason TEXT,
  previous_classification_explanation TEXT,
  -- Captured so undo restores provenance, not just values. Reverting a rule
  -- that overrode an earlier one must leave the row pointing at that earlier
  -- rule; nulling it would show "not set by a rule" on a row whose values
  -- still came from one.
  previous_applied_by_rule_id UUID,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ
);

ALTER TABLE public.rule_applications ENABLE ROW LEVEL SECURITY;

-- Read-only to the client. Writes happen only inside the SECURITY DEFINER
-- functions below, which is what keeps the log honest as an audit trail.
CREATE POLICY "Users can view their own rule applications"
  ON public.rule_applications FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rule_applications_rule
  ON public.rule_applications (rule_id) WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rule_applications_transaction
  ON public.rule_applications (transaction_id);

-- Provenance on the transaction itself, so the UI can render "set by a rule"
-- without joining the log on every row.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS applied_by_rule_id UUID
    REFERENCES public.categorization_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_applied_by_rule
  ON public.transactions (applied_by_rule_id)
  WHERE applied_by_rule_id IS NOT NULL;

-- ── 5. Matching predicate ─────────────────────────────────────────────────
-- One definition of "does this rule match this transaction", used by preview,
-- apply, and the read path. Duplicating it would guarantee drift between the
-- count shown in the confirmation prompt and the rows actually changed.

CREATE OR REPLACE FUNCTION public.transaction_matches_rule(
  p_match_type public.rule_match_type,
  p_match_value TEXT,
  p_merchant_entity_id TEXT,
  p_merchant_category_code TEXT,
  p_merchant_normalized TEXT
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
      -- Prefix match on the normalized name: a rule for "walgreens" should
      -- catch "walgreens store" but not "walgreens" inside another word.
      p_merchant_normalized IS NOT NULL
      AND p_match_value IS NOT NULL
      AND (p_merchant_normalized = p_match_value
           OR p_merchant_normalized LIKE p_match_value || ' %')
  END;
$$;

-- ── 6. Preview: how many transactions would this rule touch? ──────────────

CREATE OR REPLACE FUNCTION public.preview_categorization_rule(
  p_match_type public.rule_match_type,
  p_match_value TEXT
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
        );
$$;

-- ── 7. Apply retroactively ────────────────────────────────────────────────
-- SECURITY DEFINER because it writes rule_applications, which has no INSERT
-- policy. Ownership is checked explicitly against auth.uid() rather than
-- inherited from RLS.

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
    RETURNING transaction_id
  )
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
  WHERE t.id = logged.transaction_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 8. Undo ───────────────────────────────────────────────────────────────

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
           ra.previous_applied_by_rule_id
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

-- ── 9. Migrate user_vendor_preferences ────────────────────────────────────
-- These were written silently from three call sites with no UI to list, edit
-- or undo them — a mislabelled vendor was permanent. They become name_pattern
-- rules, which are visible and reversible.
--
-- Not applied retroactively here: applying on behalf of a user during a
-- migration would rewrite their transactions with no prompt and no record of
-- consent. The rules land visible in the management screen, where applying is
-- one click and shows its blast radius first.

INSERT INTO public.categorization_rules (
  user_id, match_type, match_value, is_medical, display_label, created_at
)
SELECT DISTINCT ON (uvp.user_id, public.normalize_merchant_name(uvp.vendor_pattern))
       uvp.user_id,
       'name_pattern'::public.rule_match_type,
       public.normalize_merchant_name(uvp.vendor_pattern),
       uvp.is_medical,
       uvp.vendor_pattern,
       uvp.created_at
FROM public.user_vendor_preferences uvp
WHERE public.normalize_merchant_name(uvp.vendor_pattern) IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uvp.user_id)
ORDER BY uvp.user_id,
         public.normalize_merchant_name(uvp.vendor_pattern),
         uvp.updated_at DESC
ON CONFLICT (user_id, match_type, match_value) DO NOTHING;

-- user_vendor_preferences is intentionally left in place for one release. The
-- classifier reads categorization_rules as of this migration; the old table is
-- dropped once no deployed edge function references it.
COMMENT ON TABLE public.user_vendor_preferences IS
  'DEPRECATED as of 20260815120000. Superseded by categorization_rules, which
   adds a precedence chain, provenance and undo. Rows were migrated in that
   migration. Drop once no deployed function reads it.';
