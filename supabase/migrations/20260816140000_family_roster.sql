-- Workstream D1 — the family roster.
--
-- From the workflow spec, Step 0: "A real roster entity, not free text. Each
-- member needs a tax-dependent flag, not just a name -- an adult child on the
-- health plan to age 26 is frequently NOT a tax dependent, and their expenses
-- are therefore not HSA-eligible. This is a common and costly trap."
--
-- Today `invoices.patient_name` is free text with a three-option picker
-- (Self / Spouse / Other...). That shape cannot answer the question the IRS
-- actually asks, which is not "who was treated" but "is this person someone
-- whose medical expenses you may pay from an HSA". Those are the same question
-- for a spouse and a different question for a 24-year-old on your insurance.
--
-- Publication 969: qualified expenses are those of the account holder, their
-- spouse, and their TAX DEPENDENTS. Health-plan coverage and tax dependency
-- diverge, and the ACA's coverage-to-26 rule is exactly where they diverge
-- most often. A child can be legitimately on the plan and legitimately not a
-- dependent, and their bills are then not HSA-eligible at all.
--
-- The important design decision here is what an unanswered tax-dependent
-- question defaults to, and the answer is NEITHER true nor false:
--
--   default TRUE  -> silently marks a non-dependent's expenses eligible. This
--                    is the trap the spec names, automated.
--   default FALSE -> silently marks a real dependent's expenses ineligible,
--                    destroying money the user is entitled to claim.
--   default NULL  -> "we have not asked yet". Gate 2 reports unknown, the
--                    substantiation step asks, and nothing is decided on the
--                    user's behalf.
--
-- So `tax_dependent` is nullable and starts NULL for everyone the migration
-- cannot classify with certainty. That is deliberately more friction than
-- guessing, on a question where a wrong guess is an audit finding.

-- ── 1. Relationship ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'family_relationship') THEN
    CREATE TYPE public.family_relationship AS ENUM (
      -- The account holder. Always qualifies; the flag is irrelevant.
      'self',
      -- Always qualifies regardless of whether they are claimed as a
      -- dependent -- Pub 969 names the spouse separately for this reason.
      'spouse',
      -- Qualifies only if a tax dependent. The age-26 trap lives here.
      'child',
      -- Parents, and anyone else claimed as a dependent. Same rule as child;
      -- kept distinct because the prompt copy differs.
      'other_dependent'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.family_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  relationship   public.family_relationship NOT NULL,
  -- NULL means unasked, not "no". See the header.
  tax_dependent  BOOLEAN,
  -- Optional, and only ever used to explain the age-26 divergence back to the
  -- user. It is NOT an input to eligibility: age does not decide dependency,
  -- the tax return does.
  date_of_birth  DATE,
  notes          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Gate 2 of the eligibility check, computed rather than stored twice.
  -- Three-valued on purpose: TRUE / FALSE / NULL-for-unknown. A two-valued
  -- column here would force the guess this migration exists to avoid.
  qualifies_for_hsa BOOLEAN GENERATED ALWAYS AS (
    CASE
      WHEN relationship IN ('self', 'spouse') THEN TRUE
      ELSE tax_dependent
    END
  ) STORED
);

COMMENT ON TABLE public.family_members IS
  'Workstream D1: who an expense was for, and whether their medical costs may
   be paid from the user''s HSA. Replaces free-text invoices.patient_name.';
COMMENT ON COLUMN public.family_members.tax_dependent IS
  'Whether this person is claimed as a tax dependent. NULL means not yet asked
   -- never assume. Irrelevant for self and spouse, who always qualify.';
COMMENT ON COLUMN public.family_members.qualifies_for_hsa IS
  'Gate 2. TRUE = their expenses are HSA-eligible, FALSE = they are not,
   NULL = we have not established dependency and must ask before claiming.';

-- A household has one account holder and at most one spouse. Without these a
-- backfill of "Self" and "Myself" would produce two account holders, and the
-- picker would then offer the user themselves twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_one_self
  ON public.family_members (user_id) WHERE relationship = 'self';
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_one_spouse
  ON public.family_members (user_id) WHERE relationship = 'spouse';
-- Case- and whitespace-insensitive: "maya" and "Maya " are one person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_unique_name
  ON public.family_members (user_id, LOWER(BTRIM(name)));
CREATE INDEX IF NOT EXISTS idx_family_members_user
  ON public.family_members (user_id) WHERE is_active;

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own family members" ON public.family_members;
CREATE POLICY "Users can view their own family members"
  ON public.family_members FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own family members" ON public.family_members;
CREATE POLICY "Users can insert their own family members"
  ON public.family_members FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own family members" ON public.family_members;
CREATE POLICY "Users can update their own family members"
  ON public.family_members FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own family members" ON public.family_members;
CREATE POLICY "Users can delete their own family members"
  ON public.family_members FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_family_members_updated_at ON public.family_members;
CREATE TRIGGER trg_family_members_updated_at
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Link expenses to the roster ────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE. Removing someone from the roster must never
-- delete their medical history -- the expenses stay, unassigned, and
-- substantiation asks again.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS patient_id UUID
    REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_patient
  ON public.invoices (user_id, patient_id) WHERE patient_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.patient_id IS
  'Workstream D1: the roster member this expense was for. patient_name is kept
   in step with it by trigger so the ~10 existing readers keep working.';

-- `patient_name` stays, and stays authoritative for display, because ten
-- frontend files and the substantiation snapshot read it. Deriving it from the
-- roster rather than dropping it is the same approach the facets migration
-- took: readers migrate incrementally instead of in one high-risk sweep, while
-- divergence between the two becomes impossible.
CREATE OR REPLACE FUNCTION public.sync_invoice_patient_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.patient_id IS NOT NULL THEN
    SELECT fm.name INTO NEW.patient_name
      FROM family_members fm
     WHERE fm.id = NEW.patient_id;
  END IF;
  -- patient_id NULL leaves patient_name untouched: historical expenses whose
  -- free-text name never matched a roster member keep the only record of who
  -- they were for. Blanking it would destroy information.
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoices_sync_patient_name ON public.invoices;
CREATE TRIGGER trg_invoices_sync_patient_name
  BEFORE INSERT OR UPDATE OF patient_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_patient_name();

-- Renaming a roster member has to reach the expenses, or the picker and the
-- expense list disagree about who someone is.
CREATE OR REPLACE FUNCTION public.propagate_family_member_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE invoices SET patient_name = NEW.name
     WHERE patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_family_members_rename ON public.family_members;
CREATE TRIGGER trg_family_members_rename
  AFTER UPDATE OF name ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.propagate_family_member_rename();

-- ── 3. Backfill from the free-text names ──────────────────────────────────
-- Every distinct patient_name becomes a roster member so no history is
-- orphaned. Relationship is inferred only where the wording is unambiguous;
-- everything else lands as other_dependent with tax_dependent NULL, which
-- surfaces in the UI as a question rather than an assumption.

/**
 * Read a free-text patient name as a relationship.
 *
 * Shared by the member insert and the expense link below, which MUST agree:
 * matching members back to expenses on the literal name would leave every
 * "Self" expense pointing at nothing once "Self" and "Myself" collapse into
 * one person.
 */
CREATE OR REPLACE FUNCTION public.classify_patient_name(p_name TEXT)
RETURNS public.family_relationship
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN LOWER(BTRIM(COALESCE(p_name, '')))
         IN ('self', 'me', 'myself', 'account holder', 'primary')
      THEN 'self'::public.family_relationship
    WHEN LOWER(BTRIM(COALESCE(p_name, '')))
         IN ('spouse', 'wife', 'husband', 'partner')
      THEN 'spouse'::public.family_relationship
    ELSE 'other_dependent'::public.family_relationship
  END;
$fn$;

COMMENT ON FUNCTION public.classify_patient_name(TEXT) IS
  'Workstream D1: map a legacy free-text patient name onto a relationship.
   Synonyms for the account holder and the spouse collapse onto one person
   each, because "Self" and "Myself" were never two different people.';

DO $$
DECLARE
  v_inserted INTEGER;
  v_linked   INTEGER;
BEGIN
  -- Self and spouse are grouped by RELATIONSHIP, not by name: the old picker
  -- wrote a literal string, so one household routinely accumulated "Self",
  -- "Me" and "Myself" for one person. Grouping by name instead would create
  -- three members, and since only one may hold the 'self' role the other two
  -- would land as dependents -- the app would then ask the user whether they
  -- claim themselves as a tax dependent, and report their OWN expenses as
  -- unresolved. Everyone else is grouped by name, where distinct spellings
  -- really can be distinct people.
  WITH named AS (
    SELECT i.user_id,
           BTRIM(i.patient_name) AS name,
           classify_patient_name(i.patient_name) AS relationship,
           i.created_at
      FROM invoices i
     WHERE i.patient_name IS NOT NULL
       AND BTRIM(i.patient_name) <> ''
  ),
  grouped AS (
    SELECT DISTINCT ON (user_id, relationship, group_key)
           user_id, relationship, name
      FROM (
        SELECT user_id, relationship, name, created_at,
               CASE WHEN relationship = 'other_dependent'
                    THEN LOWER(BTRIM(name)) ELSE '' END AS group_key
          FROM named
      ) s
     -- Earliest use wins the display name, so the roster shows the wording
     -- the user started with rather than an alphabetical accident.
     ORDER BY user_id, relationship, group_key, created_at
  )
  INSERT INTO family_members (user_id, name, relationship, tax_dependent)
  SELECT user_id, name, relationship,
    -- Only self and spouse are certain, and for them the flag is moot anyway
    -- since qualifies_for_hsa ignores it. Everyone else is NULL: unasked.
    -- Guessing TRUE here would automate the exact trap this table exists for.
    CASE WHEN relationship IN ('self', 'spouse') THEN TRUE ELSE NULL END
  FROM grouped
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Linked by the same classification, so all of "Self"/"Me"/"Myself" reach
  -- the one account-holder row.
  UPDATE invoices i
     SET patient_id = fm.id
    FROM family_members fm
   WHERE fm.user_id = i.user_id
     AND i.patient_id IS NULL
     AND i.patient_name IS NOT NULL
     AND fm.relationship = classify_patient_name(i.patient_name)
     AND (
       classify_patient_name(i.patient_name) IN ('self', 'spouse')
       OR LOWER(BTRIM(fm.name)) = LOWER(BTRIM(i.patient_name))
     );

  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- Anyone who has used the app but never recorded a patient still needs to
  -- exist on their own roster, or the picker opens empty and the commonest
  -- case -- an expense for yourself -- has nothing to select.
  INSERT INTO family_members (user_id, name, relationship, tax_dependent)
  SELECT p.id, 'Me', 'self', TRUE
    FROM profiles p
   WHERE NOT EXISTS (
     SELECT 1 FROM family_members fm
      WHERE fm.user_id = p.id AND fm.relationship = 'self'
   )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Family roster backfill: % member(s) created, % expense(s) linked.',
    v_inserted, v_linked;
END
$$;

-- ── 4. Gate 2 ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_dependency_gate(p_invoice_id UUID)
RETURNS TABLE (
  status  TEXT,   -- 'eligible' | 'ineligible' | 'unknown'
  patient TEXT,
  reason  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT i.patient_id, i.patient_name, i.user_id,
         fm.name AS member_name, fm.relationship, fm.tax_dependent,
         fm.qualifies_for_hsa
    INTO v_rec
    FROM invoices i
    LEFT JOIN family_members fm ON fm.id = i.patient_id
   WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_rec.patient_id IS NULL THEN
    RETURN QUERY SELECT
      'unknown'::TEXT,
      v_rec.patient_name,
      CASE
        WHEN v_rec.patient_name IS NULL
          THEN 'We need to know who this expense was for.'
        ELSE 'Tell us who ' || v_rec.patient_name ||
             ' is so we can check whether their expenses qualify.'
      END;
    RETURN;
  END IF;

  IF v_rec.qualifies_for_hsa IS TRUE THEN
    RETURN QUERY SELECT
      'eligible'::TEXT,
      v_rec.member_name,
      CASE v_rec.relationship
        WHEN 'self'   THEN 'Your own medical expenses always qualify.'
        WHEN 'spouse' THEN 'A spouse''s medical expenses always qualify, whether or not you claim them as a dependent.'
        ELSE v_rec.member_name || ' is a tax dependent, so their medical expenses qualify.'
      END;
  ELSIF v_rec.qualifies_for_hsa IS FALSE THEN
    RETURN QUERY SELECT
      'ineligible'::TEXT,
      v_rec.member_name,
      v_rec.member_name || ' is not claimed as a tax dependent, so HSA money cannot be used for their medical expenses — even if they are on your health plan.';
  ELSE
    RETURN QUERY SELECT
      'unknown'::TEXT,
      v_rec.member_name,
      'We need to know whether you claim ' || v_rec.member_name ||
      ' as a tax dependent. Being on your health plan is not the same thing, and only tax dependency makes their expenses HSA-eligible.';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.expense_dependency_gate(UUID) IS
  'Workstream D1/D3, Gate 2: may HSA money pay for this person''s care?
   Reports eligible / ineligible / unknown -- never guesses.';

GRANT EXECUTE ON FUNCTION public.expense_dependency_gate(UUID) TO authenticated;
