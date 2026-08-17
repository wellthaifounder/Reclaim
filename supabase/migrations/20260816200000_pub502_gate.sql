-- Workstream D4 — Gate 3, the nature of the expense.
--
-- From the workflow spec: "Gate 3 (Pub 502 -- judgment lives here)". Gates 1
-- and 2 are facts; this one is the only place a person's opinion legitimately
-- decides the answer. That distinction drives the whole design below.
--
-- Three things were wrong or missing.
--
-- 1. NOTHING ACTED ON THE RULE. classify-expense stamped
--    eligibility_basis_rule_id and a confidence, but eligibility_state was
--    deliberately left untouched. So a rule saying "cosmetic surgery,
--    ineligible" had no effect: the expense stayed claimable.
--
-- 2. THE CATALOG REFUSED MONEY USERS ARE ENTITLED TO. `health-club` was
--    marked ineligible outright. A gym membership prescribed for a diagnosed
--    condition IS claimable with a letter of medical necessity, and the spec
--    names it as the headline conditional case. Marking it a flat no is a
--    false negative that costs the user real money and that they have no way
--    to appeal.
--
-- 3. THERE WERE NO PREMIUM RULES AT ALL, so every insurance premium fell to
--    the catch-all. Premiums are mostly not qualified, but Pub 969 names four
--    exceptions, and they are large recurring amounts: COBRA, coverage while
--    receiving unemployment compensation, Medicare Parts A/B/D at 65+ (NOT
--    Medigap), and qualified long-term-care premiums up to age-based caps.
--    Silence on those is the most expensive kind of missing rule.
--
-- 'conditional' is not a refusal. It means "claimable once you have the
-- letter", which is why it maps to the eligibility facet's own 'conditional'
-- value rather than to 'ineligible' -- the user is being told what to go get,
-- not turned away.

-- ── 1. Catalog columns ────────────────────────────────────────────────────

ALTER TABLE public.pub_502_rules
  ADD COLUMN IF NOT EXISTS lmn_prompt TEXT;

COMMENT ON COLUMN public.pub_502_rules.lmn_prompt IS
  'Workstream D4: what to ask the user for when this rule is conditional.
   Shown verbatim, so it names the specific document and who has to write it.';

-- 'unknown' is a real and distinct outcome: the classifier could not place the
-- expense. Previously `unclassified-other` was filed as 'conditional', which
-- told the user to go get a letter of medical necessity for something we had
-- simply failed to recognise.
ALTER TABLE public.pub_502_rules
  DROP CONSTRAINT IF EXISTS pub_502_rules_eligibility_status_check;
ALTER TABLE public.pub_502_rules
  ADD CONSTRAINT pub_502_rules_eligibility_status_check
  CHECK (eligibility_status IN ('eligible', 'conditional', 'ineligible', 'unknown'));

UPDATE public.pub_502_rules
   SET eligibility_status = 'unknown',
       conditions = 'Could not be matched to a Pub 502 category. Needs a human decision, not a letter.',
       lmn_prompt = NULL
 WHERE id = 'unclassified-other';

-- ── 2. Conditional catalog ────────────────────────────────────────────────
-- The spec's open item: "which Pub 502 categories are marked conditional, and
-- the prompt copy for each".

UPDATE public.pub_502_rules
   SET eligibility_status = 'conditional',
       conditions = 'Qualifies only when a physician prescribes it to treat a specific diagnosed condition, not for general health or fitness.',
       lmn_prompt = 'To claim this, you need a letter from your doctor saying the membership treats a specific diagnosed condition — general fitness does not qualify. The letter should name the condition and the treatment.',
       section_ref = COALESCE(section_ref, 'Pub 502, Health Club Dues'),
       notes = 'Reclassified in D4. Was a flat "ineligible", which refused a legitimately claimable expense with no way for the user to appeal.'
 WHERE id = 'health-club';

INSERT INTO public.pub_502_rules
  (id, name, category, eligibility_status, conditions, section_ref, examples, lmn_prompt, effective_year)
VALUES
  ('weight-loss-program', 'Weight-Loss Program', 'Medical', 'conditional',
   'Qualifies when undertaken to treat a specific disease diagnosed by a physician (obesity, hypertension, heart disease). General health or appearance does not qualify.',
   'Pub 502, Weight-Loss Program',
   ARRAY['medically supervised weight-loss program', 'physician-directed obesity treatment'],
   'To claim this, you need a letter from your doctor confirming the program treats a diagnosed condition such as obesity, hypertension or heart disease. Weight loss for general health or appearance does not qualify.',
   2025),

  ('special-foods', 'Special Foods and Beverages', 'Medical', 'conditional',
   'Only the amount by which the cost EXCEEDS the cost of ordinary food qualifies, and only when prescribed to alleviate a specific illness.',
   'Pub 502, Nutritional Supplements / Special Foods',
   ARRAY['gluten-free food for diagnosed celiac disease', 'prescribed therapeutic formula'],
   'To claim this, you need a letter from your doctor stating the food is required to treat a specific illness. Note you can only claim the extra cost above what ordinary food would have cost, not the full amount.',
   2025),

  ('home-modification', 'Home Modifications (Capital Expense)', 'Medical Equipment', 'conditional',
   'Qualifies to the extent the cost exceeds any increase in the property''s value. Modifications for a disabled resident often have no value increase and so may qualify in full.',
   'Pub 502, Capital Expenses',
   ARRAY['entrance ramp', 'widened doorways for a wheelchair', 'bathroom grab bars and railings'],
   'To claim this, you need a letter from your doctor explaining the medical need. You may also need an appraisal: only the cost above any increase in your home''s value qualifies, though modifications for accessibility often add no value and can be claimed in full.',
   2025),

  ('medical-travel', 'Travel for Medical Care', 'Medical', 'conditional',
   'Transport primarily for and essential to medical care. A standard mileage rate applies for a personal car; see regulatoryLimits.ts for the current rate.',
   'Pub 502, Transportation',
   ARRAY['mileage to and from appointments', 'ambulance not otherwise covered', 'air or rail fare to a treatment centre'],
   'Keep a record of the trip: the date, where you went, the medical reason, and the miles driven. Travel has to be primarily for and essential to the medical care.',
   2025),

  ('medical-lodging', 'Lodging for Medical Care', 'Medical', 'conditional',
   'Capped per night per person, and only when away from home primarily for and essential to medical care, with no significant element of recreation.',
   'Pub 502, Lodging',
   ARRAY['hotel near a treatment centre', 'lodging for a parent accompanying a child patient'],
   'Tell us the treatment this trip was for and how many nights. There is a per-night cap, and the trip cannot include a significant holiday element.',
   2025)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Insurance premiums ─────────────────────────────────────────────────
-- Pub 969: premiums are generally NOT payable from an HSA, with four
-- exceptions. Naming them explicitly matters because they are large and
-- recurring, and because the general rule alone would refuse all four.

INSERT INTO public.pub_502_rules
  (id, name, category, eligibility_status, conditions, section_ref, examples, lmn_prompt, effective_year)
VALUES
  ('premiums-general', 'Health Insurance Premiums (General)', 'Insurance', 'ineligible',
   'Ordinary health insurance premiums are not a qualified HSA expense. See the four exceptions below.',
   'Pub 969, Insurance Premiums', NULL, NULL, 2025),

  ('premiums-cobra', 'COBRA Continuation Premiums', 'Insurance', 'eligible',
   'Health care continuation coverage premiums are a qualified HSA expense.',
   'Pub 969, Insurance Premiums',
   ARRAY['COBRA premium after leaving a job'], NULL, 2025),

  ('premiums-unemployment', 'Premiums While Receiving Unemployment', 'Insurance', 'eligible',
   'Health coverage premiums paid while receiving federal or state unemployment compensation are a qualified HSA expense.',
   'Pub 969, Insurance Premiums', NULL, NULL, 2025),

  ('premiums-medicare', 'Medicare Premiums (Age 65+)', 'Insurance', 'conditional',
   'Medicare Part A, B and D premiums qualify once the account holder is 65 or older. Medigap / Medicare Supplement premiums NEVER qualify.',
   'Pub 969, Insurance Premiums',
   ARRAY['Medicare Part B premium', 'Medicare Part D prescription plan'],
   'Confirm this is Medicare Part A, B or D and that you were 65 or older. Medigap and Medicare Supplement plans do not qualify at any age.',
   2025)
ON CONFLICT (id) DO NOTHING;

UPDATE public.pub_502_rules
   SET conditions = 'Qualified long-term care insurance premiums qualify only up to an age-based annual cap; qualified long-term care services qualify in full.',
       lmn_prompt = 'Tell us your age at the time of payment. Long-term care insurance premiums are only claimable up to an annual limit that depends on your age.',
       section_ref = COALESCE(section_ref, 'Pub 969, Insurance Premiums')
 WHERE id = 'long-term-care';

-- Cosmetic surgery keeps its refusal but records the carve-out, so the
-- classifier's reasoning can raise it rather than the user hitting a flat no
-- on reconstructive work that genuinely qualifies.
UPDATE public.pub_502_rules
   SET conditions = 'Not qualified when it merely improves appearance. Qualified when it corrects a congenital abnormality, a disfiguring disease, or an injury from an accident or trauma.',
       section_ref = COALESCE(section_ref, 'Pub 502, Cosmetic Surgery')
 WHERE id = 'cosmetic-surgery';

-- ── 4. The 2024/2025 rulings already recorded in CLAUDE.md ────────────────
-- Present in the project's regulatory notes but absent from the catalog, so
-- the classifier had no rule to match them to and they fell to 'unknown'.

INSERT INTO public.pub_502_rules
  (id, name, category, eligibility_status, conditions, section_ref, examples, effective_year)
VALUES
  ('otc-medicine', 'Over-the-Counter Medicines', 'Pharmacy', 'eligible',
   'No prescription required, for amounts paid after 2019 (CARES Act).',
   'Pub 502, Medicines',
   ARRAY['pain relievers', 'allergy medication', 'cold and flu remedies'], 2025),

  ('menstrual-products', 'Menstrual Care Products', 'Pharmacy', 'eligible',
   'Qualified medical expense for amounts paid after 2019 (CARES Act).',
   'Pub 502, Medicines',
   ARRAY['tampons', 'pads', 'menstrual cups'], 2025),

  ('otc-contraceptives', 'Over-the-Counter Contraceptives', 'Pharmacy', 'eligible',
   'Notice 2024-75: OTC oral and emergency contraceptives are preventive care and qualify without a prescription. Male condoms qualify as both preventive care and a Section 213(d) expense.',
   'Notice 2024-75',
   ARRAY['OTC oral contraceptives', 'emergency contraception', 'condoms'], 2025),

  ('cgm-diabetic', 'Continuous Glucose Monitor', 'Medical Equipment', 'eligible',
   'Notice 2024-75: CGMs for a diagnosed diabetic are preventive care, so an HDHP may cover them before the deductible.',
   'Notice 2024-75',
   ARRAY['continuous glucose monitor', 'CGM sensors'], 2025)
ON CONFLICT (id) DO NOTHING;

-- ── 5. The letter itself ──────────────────────────────────────────────────
-- A conditional expense is cleared by attaching the letter, so the letter has
-- to be a document type we can recognise. Derived from the documents present
-- rather than a separate flag: two places recording "has a letter" is how they
-- come to disagree.

ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_document_type_check;
ALTER TABLE public.receipts ADD CONSTRAINT receipts_document_type_check
  CHECK (document_type IN (
    'receipt', 'invoice', 'bill', 'itemized_statement', 'eob',
    'payment_receipt', 'payment_plan_agreement',
    'letter_of_medical_necessity',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_receipts_lmn
  ON public.receipts (invoice_id)
  WHERE document_type = 'letter_of_medical_necessity';

-- ── 6. Gate 3, folded into the single writer ──────────────────────────────
-- D3 established that eligibility has exactly one writer, because independent
-- per-gate recomputes each restored what the others refused. Gate 3 joins that
-- writer rather than getting its own.

CREATE OR REPLACE FUNCTION public.gate_owned_reasons()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT ARRAY[
    'pre_establishment',      -- Gate 1
    'not_tax_dependent',      -- Gate 2
    'not_qualified_expense'   -- Gate 3
  ]::TEXT[];
$fn$;

/**
 * The verdict of every gate, as one answer.
 *
 * Returns the eligibility facet to store plus the reason code. Never returns
 * 'eligible': that value is earned by explicit user confirmation, which is the
 * audit-trail event a substantiation record rests on. The gates can only ever
 * refuse, defer, or stand aside.
 */
CREATE OR REPLACE FUNCTION public.expense_gate_verdict(
  p_service_date DATE,
  p_hsa_date     DATE,
  p_qualifies    BOOLEAN,
  p_rule_status  TEXT,
  p_has_lmn      BOOLEAN
)
RETURNS TABLE (state public.expense_eligibility_state, reason TEXT)
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT
    CASE
      -- Gate 1. Permanent and unappealable, so it outranks everything.
      WHEN p_hsa_date IS NOT NULL AND p_service_date IS NOT NULL
           AND p_service_date < p_hsa_date
        THEN 'ineligible'::public.expense_eligibility_state
      -- Gate 2. Only a definite FALSE refuses; NULL is unasked, not "no".
      WHEN p_qualifies IS FALSE
        THEN 'ineligible'::public.expense_eligibility_state
      -- Gate 3.
      WHEN p_rule_status = 'ineligible'
        THEN 'ineligible'::public.expense_eligibility_state
      -- Not a refusal: "claimable once you have the letter".
      WHEN p_rule_status = 'conditional' AND COALESCE(p_has_lmn, FALSE) = FALSE
        THEN 'conditional'::public.expense_eligibility_state
      ELSE 'unknown'::public.expense_eligibility_state
    END,
    CASE
      WHEN p_hsa_date IS NOT NULL AND p_service_date IS NOT NULL
           AND p_service_date < p_hsa_date            THEN 'pre_establishment'
      WHEN p_qualifies IS FALSE                       THEN 'not_tax_dependent'
      WHEN p_rule_status = 'ineligible'               THEN 'not_qualified_expense'
      ELSE NULL
    END;
$fn$;

COMMENT ON FUNCTION public.expense_gate_verdict(DATE, DATE, BOOLEAN, TEXT, BOOLEAN) IS
  'Workstream D4: all three gates as one answer. Never returns eligible --
   that is earned by explicit user confirmation, not computed.';

-- Kept: D3 callers and the trigger still ask "which gate refuses?".
CREATE OR REPLACE FUNCTION public.expense_blocking_gate_reason(
  p_service_date DATE,
  p_hsa_date     DATE,
  p_qualifies    BOOLEAN
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT reason FROM public.expense_gate_verdict(
    p_service_date, p_hsa_date, p_qualifies, NULL, NULL
  );
$fn$;

CREATE OR REPLACE FUNCTION public.recompute_expense_eligibility(
  p_user_id UUID,
  p_invoice_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (blocked INTEGER, restored INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hsa      DATE;
  v_blocked  INTEGER := 0;
  v_restored INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'recompute_expense_eligibility requires a user id';
  END IF;
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_hsa := hsa_establishment_date(p_user_id);

  CREATE TEMP TABLE _verdicts ON COMMIT DROP AS
  SELECT i.id,
         i.eligibility_state AS current_state,
         i.ineligible_reason AS current_reason,
         i.confirmed_at,
         v.state  AS want_state,
         v.reason AS want_reason,
         -- Which gate is refusing matters for whether a user's own
         -- determination survives it (see below).
         (v.reason IN ('pre_establishment', 'not_tax_dependent')) AS is_factual_refusal
    FROM invoices i
    LEFT JOIN family_members fm ON fm.id = i.patient_id
    LEFT JOIN pub_502_rules  pr ON pr.id = i.eligibility_basis_rule_id
    CROSS JOIN LATERAL expense_gate_verdict(
      i.effective_service_date,
      v_hsa,
      fm.qualifies_for_hsa,
      pr.eligibility_status,
      EXISTS (
        SELECT 1 FROM receipts r
         WHERE r.invoice_id = i.id
           AND r.document_type = 'letter_of_medical_necessity'
      )
    ) v
   WHERE i.user_id = p_user_id
     -- An expense inside a submitted request belongs to an immutable record
     -- already sent to a custodian.
     AND i.claim_state IN ('unclaimed', 'not_reimbursable')
     AND (p_invoice_ids IS NULL OR i.id = ANY (p_invoice_ids));

  -- Refuse.
  UPDATE invoices i
     SET eligibility_state = 'ineligible',
         ineligible_reason = t.want_reason,
         updated_at        = now()
    FROM _verdicts t
   WHERE i.id = t.id
     AND t.want_state = 'ineligible'
     AND (t.current_state <> 'ineligible'
          OR t.current_reason IS DISTINCT FROM t.want_reason)
     -- Never overwrite a refusal this system did not make.
     AND (t.current_state <> 'ineligible'
          OR t.current_reason IS NULL
          OR t.current_reason = ANY (gate_owned_reasons()))
     -- The spec: gates 1 and 2 are facts, gate 3 is judgment. A user who has
     -- explicitly confirmed an expense has made the judgment call Gate 3 only
     -- advises on, so their decision stands against it -- but not against a
     -- fact. Overruling someone on a Pub 502 category is how a correct
     -- determination gets silently reversed; overruling them on the HSA
     -- opening date is just arithmetic.
     AND (t.confirmed_at IS NULL OR t.is_factual_refusal);

  GET DIAGNOSTICS v_blocked = ROW_COUNT;

  -- Defer: conditional, awaiting the letter.
  UPDATE invoices i
     SET eligibility_state = 'conditional',
         ineligible_reason = NULL,
         updated_at        = now()
    FROM _verdicts t
   WHERE i.id = t.id
     AND t.want_state = 'conditional'
     AND t.current_state <> 'conditional'
     -- A user confirmation already answers the question the letter would.
     AND t.confirmed_at IS NULL
     AND (t.current_state = 'unknown'
          OR (t.current_state = 'ineligible'
              AND t.current_reason = ANY (gate_owned_reasons())));

  -- Stand aside: no gate refuses. Restores from a gate-owned refusal, and
  -- clears 'conditional' once the letter is attached.
  --
  -- To 'unknown', never 'eligible': clearing the gates does not make an
  -- expense qualified, it only stops disqualifying it. Confirmation does the
  -- rest, which is why an already-confirmed expense is left alone here.
  UPDATE invoices i
     SET eligibility_state = 'unknown',
         ineligible_reason = NULL,
         updated_at        = now()
    FROM _verdicts t
   WHERE i.id = t.id
     AND t.want_state = 'unknown'
     AND t.confirmed_at IS NULL
     AND (t.current_state = 'conditional'
          OR (t.current_state = 'ineligible'
              AND t.current_reason = ANY (gate_owned_reasons())));

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  DROP TABLE IF EXISTS _verdicts;
  RETURN QUERY SELECT v_blocked, v_restored;
END;
$fn$;

-- ── 7. Keep it current ────────────────────────────────────────────────────

-- Classification result changing is a Gate 3 input change, so it has to
-- re-run the gates the same way a date or patient change does.
CREATE OR REPLACE FUNCTION public.propagate_classification_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.eligibility_basis_rule_id IS NOT DISTINCT FROM OLD.eligibility_basis_rule_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.recompute_expense_eligibility(NEW.user_id, ARRAY[NEW.id]);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoices_classification ON public.invoices;
CREATE TRIGGER trg_invoices_classification
  AFTER UPDATE OF eligibility_basis_rule_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.propagate_classification_change();

-- Attaching or removing the letter is what clears a conditional expense.
CREATE OR REPLACE FUNCTION public.propagate_lmn_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_invoice UUID;
  v_user    UUID;
BEGIN
  v_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(NEW.document_type, OLD.document_type) <> 'letter_of_medical_necessity' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT user_id INTO v_user FROM invoices WHERE id = v_invoice;
  IF v_user IS NOT NULL THEN
    PERFORM public.recompute_expense_eligibility(v_user, ARRAY[v_invoice]);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipts_lmn ON public.receipts;
CREATE TRIGGER trg_receipts_lmn
  AFTER INSERT OR DELETE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.propagate_lmn_change();

-- ── 8. Reporting ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_pub502_gate(p_invoice_id UUID)
RETURNS TABLE (
  status      TEXT,
  rule_id     TEXT,
  rule_name   TEXT,
  reason      TEXT,
  lmn_prompt  TEXT,
  has_lmn     BOOLEAN,
  confidence  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec RECORD;
  v_lmn BOOLEAN;
BEGIN
  SELECT i.user_id, i.eligibility_basis_rule_id, i.classification_reasoning,
         i.classification_confidence,
         pr.name AS rule_name, pr.eligibility_status, pr.conditions, pr.lmn_prompt
    INTO v_rec
    FROM invoices i
    LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
   WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM receipts r
     WHERE r.invoice_id = p_invoice_id
       AND r.document_type = 'letter_of_medical_necessity'
  ) INTO v_lmn;

  IF v_rec.eligibility_basis_rule_id IS NULL THEN
    RETURN QUERY SELECT
      'unknown'::TEXT, NULL::TEXT, NULL::TEXT,
      'We have not worked out what kind of expense this is yet. Add your documents and we will.'::TEXT,
      NULL::TEXT, v_lmn, NULL::NUMERIC;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_rec.eligibility_status, 'unknown')::TEXT,
    v_rec.eligibility_basis_rule_id,
    v_rec.rule_name,
    -- The classifier's own sentence is preferred: it is specific to this
    -- expense, where the rule's `conditions` is generic to the category.
    COALESCE(
      NULLIF(v_rec.classification_reasoning, ''),
      v_rec.conditions,
      'Matched to ' || COALESCE(v_rec.rule_name, 'a Pub 502 category') || '.'
    )::TEXT,
    CASE WHEN v_rec.eligibility_status = 'conditional' AND NOT v_lmn
         THEN v_rec.lmn_prompt ELSE NULL END,
    v_lmn,
    v_rec.classification_confidence;
END;
$fn$;

COMMENT ON FUNCTION public.expense_pub502_gate(UUID) IS
  'Workstream D4, Gate 3: what kind of expense this is under Pub 502, and what
   the user must supply if it is conditional.';

-- Gains an action_prompt column for the letter-of-medical-necessity ask, so
-- the D3 signature has to go first: Postgres will not change the row type of
-- an existing set-returning function in place.
DROP FUNCTION IF EXISTS public.expense_eligibility_gates(UUID);

CREATE OR REPLACE FUNCTION public.expense_eligibility_gates(p_invoice_id UUID)
RETURNS TABLE (
  gate         TEXT,
  status       TEXT,
  reason       TEXT,
  is_blocking  BOOLEAN,
  is_permanent BOOLEAN,
  action_prompt TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user UUID;
BEGIN
  SELECT i.user_id INTO v_user FROM invoices i WHERE i.id = p_invoice_id;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_user <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT 'timing'::TEXT, t.status, t.reason,
           (t.status = 'ineligible'),
           -- The only gate a user can never act on. Saying so is what stops
           -- them attaching more documents to a lost cause.
           TRUE, NULL::TEXT
      FROM expense_timing_gate(p_invoice_id) t
    UNION ALL
    SELECT 'dependency'::TEXT, d.status, d.reason,
           (d.status = 'ineligible'), FALSE, NULL::TEXT
      FROM expense_dependency_gate(p_invoice_id) d
    UNION ALL
    SELECT 'pub502'::TEXT, p.status, p.reason,
           (p.status = 'ineligible'), FALSE, p.lmn_prompt
      FROM expense_pub502_gate(p_invoice_id) p;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.expense_gate_verdict(DATE, DATE, BOOLEAN, TEXT, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_pub502_gate(UUID) TO authenticated;

-- ── 9. Apply Gate 3 to existing history ───────────────────────────────────
-- Expenses already carry a rule id from the capture-time classifier; nothing
-- ever acted on it.

DO $$
DECLARE r RECORD; v_total INTEGER := 0; v_b INTEGER; v_r INTEGER;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM invoices
            WHERE eligibility_basis_rule_id IS NOT NULL
  LOOP
    -- recompute_expense_eligibility enforces auth.uid(); this backfill runs as
    -- the migration owner with no JWT, so apply the same logic directly.
    WITH v AS (
      SELECT i.id, gv.state, gv.reason
        FROM invoices i
        LEFT JOIN family_members fm ON fm.id = i.patient_id
        LEFT JOIN pub_502_rules  pr ON pr.id = i.eligibility_basis_rule_id
        CROSS JOIN LATERAL expense_gate_verdict(
          i.effective_service_date, hsa_establishment_date(i.user_id),
          fm.qualifies_for_hsa, pr.eligibility_status,
          EXISTS (SELECT 1 FROM receipts rr WHERE rr.invoice_id = i.id
                    AND rr.document_type = 'letter_of_medical_necessity')
        ) gv
       WHERE i.user_id = r.user_id
         AND i.claim_state IN ('unclaimed', 'not_reimbursable')
         AND i.confirmed_at IS NULL
    )
    UPDATE invoices i
       SET eligibility_state = v.state,
           ineligible_reason = v.reason,
           updated_at        = now()
      FROM v
     WHERE i.id = v.id
       AND v.state <> 'unknown'
       AND i.eligibility_state = 'unknown';
    GET DIAGNOSTICS v_b = ROW_COUNT;
    v_total := v_total + v_b;
  END LOOP;
  RAISE NOTICE 'Gate 3 backfill: % expense(s) moved off "unknown".', v_total;
END
$$;
