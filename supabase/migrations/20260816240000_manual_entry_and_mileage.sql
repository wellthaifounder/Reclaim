-- Workstream D6 — manual entry as a first-class peer, and medical mileage.
--
-- From the spec: "Bank sync structurally cannot see medical mileage, cash
-- payments, or certain premiums. Manual entry creates an Expense directly,
-- skipping Step 1."
--
-- Four things here.
--
-- 1. MILEAGE AS EVIDENCE, NOT JUST A DOLLAR AMOUNT. Pub. 502 substantiates a
--    car trip with a log: date, destination, purpose, miles. If only the
--    computed dollar figure is stored, an audit years later cannot show the
--    work -- and neither can we, if a rate we applied turns out to have been
--    wrong. So the miles, the rate applied, and the parking/tolls add-on are
--    all stored, and a CHECK keeps the dollar amount equal to the arithmetic.
--    The amount and its own evidence cannot drift apart.
--
-- 2. A PUB 502 RULE FOR MILEAGE. Transportation primarily for and essential to
--    medical care is qualified outright (Pub. 502, "Transportation"). The
--    existing `medical-travel` rule is conditional, which is right for
--    out-of-town trips and airfare but wrong for the ordinary drive to the
--    clinic -- and a mileage entry has no vendor string to classify anyway.
--
-- 3. DOCUMENTATION STATE MAINTAINED BY THE DATABASE. Today every upload
--    surface sets `documentation_state` by hand at insert, and most of the
--    call sites that attach or remove a document do not touch it at all:
--    attaching an existing document from the library, deleting the last
--    receipt from the gallery, and manual entry's own optional receipt upload
--    all leave the expense claiming the opposite of the truth. One trigger,
--    every call site, no exceptions.
--
-- 4. A MILEAGE EXPENSE IS ALREADY DOCUMENTED. It has no receipt and never
--    will; the log IS the substantiation. Without this, every mileage entry
--    would sit in "needs documentation" forever, nagging for a piece of paper
--    that does not exist.

-- ── 1. Mileage columns ────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS mileage_miles         NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS mileage_rate          NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS mileage_parking_tolls NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS mileage_trips         INTEGER;

COMMENT ON COLUMN public.invoices.mileage_miles IS
  'Workstream D6: TOTAL miles driven for medical care. Non-null marks this
   expense a mileage entry rather than a payment.';
COMMENT ON COLUMN public.invoices.mileage_trips IS
  'Workstream D6: how many trips those miles cover, so a course of treatment
   can be logged once -- "13 dialysis runs in March" -- instead of thirteen
   times. Kept alongside the total because "312 miles" alone loses the shape of
   the log Pub. 502 asks for; miles per trip is total / trips.';
COMMENT ON COLUMN public.invoices.mileage_rate IS
  'Workstream D6: the IRS per-mile rate APPLIED, stored rather than looked up
   later. The rate in force depends on date of service and has changed
   mid-year (2022); recomputing it from a table years from now would silently
   rewrite history.';
COMMENT ON COLUMN public.invoices.mileage_parking_tolls IS
  'Workstream D6: parking fees and tolls, claimable on top of the per-mile
   amount under Pub. 502 rather than folded into the rate.';

-- All three mileage facts travel together, and the money must equal the
-- arithmetic. A rate outside a plausible band is a bug, not a user: the IRS
-- medical rate has never left 14-24 cents, so anything above a dollar a mile
-- is an order-of-magnitude error reaching a tax document.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_mileage_coherent;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_mileage_coherent
  CHECK (
    (mileage_miles IS NULL AND mileage_rate IS NULL)
    OR (
      mileage_miles IS NOT NULL
      AND mileage_rate IS NOT NULL
      AND mileage_miles > 0
      AND mileage_rate > 0 AND mileage_rate <= 1.00
      AND COALESCE(mileage_parking_tolls, 0) >= 0
      AND amount_paid IS NOT NULL
      AND ABS(
            amount_paid
            - (ROUND(mileage_miles * mileage_rate, 2)
               + COALESCE(mileage_parking_tolls, 0))
          ) <= 0.005
    )
  );

COMMENT ON CONSTRAINT invoices_mileage_coherent ON public.invoices IS
  'Workstream D6: a mileage expense must carry the miles and the rate that
   produced its dollar amount, and that amount must equal the arithmetic. The
   claim and its own evidence cannot drift apart.';

-- Parking/tolls and a trip count without miles is a plain expense, not a
-- mileage entry.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_mileage_extras_need_miles;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_mileage_extras_need_miles
  CHECK (
    (mileage_parking_tolls IS NULL OR mileage_miles IS NOT NULL)
    AND (mileage_trips IS NULL OR (mileage_trips > 0 AND mileage_miles IS NOT NULL))
  );

CREATE INDEX IF NOT EXISTS idx_invoices_mileage
  ON public.invoices (user_id, effective_service_date)
  WHERE mileage_miles IS NOT NULL;

-- ── 2. The Pub 502 rule ───────────────────────────────────────────────────

INSERT INTO public.pub_502_rules
  (id, name, category, eligibility_status, conditions, section_ref, examples,
   effective_year, notes)
VALUES (
  'medical-mileage',
  'Car travel for medical care',
  'transportation',
  'eligible',
  'The trip must be primarily for, and essential to, medical care. Commuting '
  || 'to work is never eligible even for a medical reason, and a trip taken '
  || 'for a change of environment or general health improvement does not '
  || 'qualify. Parking fees and tolls are claimable in addition to the '
  || 'per-mile amount.',
  'Pub. 502, Transportation',
  ARRAY[
    'Driving to a doctor, dentist, therapist or hospital',
    'Driving a child or dependent to their appointment',
    'Trips to collect a prescription',
    'Regular travel for dialysis, chemotherapy or physical therapy'
  ],
  2025,
  'Workstream D6. Distinct from medical-travel, which stays conditional and '
  || 'covers out-of-town trips, airfare and lodging. The ordinary drive to a '
  || 'local appointment is qualified outright and should not be made to wait '
  || 'on a letter of medical necessity.'
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  category           = EXCLUDED.category,
  eligibility_status = EXCLUDED.eligibility_status,
  conditions         = EXCLUDED.conditions,
  section_ref        = EXCLUDED.section_ref,
  examples           = EXCLUDED.examples,
  notes              = EXCLUDED.notes,
  updated_at         = now();

-- ── 3. Documentation state, maintained centrally ──────────────────────────

CREATE OR REPLACE FUNCTION public.sync_expense_documentation_state(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE invoices i
     SET documentation_state = (
           CASE
             WHEN EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)
               THEN 'complete'
             -- A mileage log has no receipt and never will. The record of the
             -- date, destination, purpose and miles is what Pub. 502 asks for,
             -- and it is already stored.
             WHEN i.mileage_miles IS NOT NULL
               THEN 'complete'
             ELSE 'none'
           END
         )::expense_documentation_state,
         updated_at = now()
   WHERE i.id = p_invoice_id
     -- Row-level security governs which invoices the caller can touch. Left as
     -- invoker rights on purpose: SECURITY DEFINER here would let a receipt
     -- pointed at someone else's invoice reach across the boundary.
     AND i.documentation_state IS DISTINCT FROM (
           CASE
             WHEN EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)
               THEN 'complete'
             WHEN i.mileage_miles IS NOT NULL
               THEN 'complete'
             ELSE 'none'
           END
         )::expense_documentation_state;
END;
$fn$;

COMMENT ON FUNCTION public.sync_expense_documentation_state(UUID) IS
  'Workstream D6: single writer for invoices.documentation_state. Every upload
   surface used to set it by hand at insert, and the surfaces that attach or
   remove a document afterwards did not set it at all.';

CREATE OR REPLACE FUNCTION public.propagate_documentation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- A document can be MOVED between expenses (attaching a library document
  -- sets invoice_id on an existing row), so both ends need recomputing.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM sync_expense_documentation_state(OLD.invoice_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM sync_expense_documentation_state(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipts_documentation ON public.receipts;
CREATE TRIGGER trg_receipts_documentation
  AFTER INSERT OR DELETE OR UPDATE OF invoice_id ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.propagate_documentation_change();

-- And on the invoice side: a mileage entry is documented the moment it is
-- created, and its dollar amount is computed here rather than sent in.
--
-- The multiplication lives in ONE place on purpose. Writing it in the browser
-- too means two implementations of the same tax arithmetic, differing in the
-- third decimal place, and a user who typed nothing wrong watching a save fail
-- because JavaScript's binary floating point and Postgres NUMERIC disagreed
-- about a half-cent. The rate still comes from the client -- IRS figures are
-- pinned to src/lib/regulatoryLimits.ts by policy -- but the sum does not.
CREATE OR REPLACE FUNCTION public.apply_mileage_derived()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_amount NUMERIC;
BEGIN
  IF NEW.mileage_miles IS NOT NULL THEN
    IF NEW.documentation_state = 'none' THEN
      NEW.documentation_state := 'complete';
    END IF;

    IF NEW.mileage_rate IS NOT NULL THEN
      -- Parking and tolls are added AFTER rounding the drive, because they are
      -- a separate claim under Pub. 502 rather than part of the per-mile
      -- figure.
      v_amount := ROUND(NEW.mileage_miles * NEW.mileage_rate, 2)
                  + COALESCE(NEW.mileage_parking_tolls, 0);
      NEW.amount      := v_amount;
      NEW.amount_paid := v_amount;

      -- Reimbursable follows the trip, except that a user is always free to
      -- claim less. Reset it when the trip itself changes, and clamp it when
      -- it would otherwise exceed what the trip is worth.
      IF TG_OP = 'INSERT'
         OR NEW.mileage_miles         IS DISTINCT FROM OLD.mileage_miles
         OR NEW.mileage_rate          IS DISTINCT FROM OLD.mileage_rate
         OR NEW.mileage_parking_tolls IS DISTINCT FROM OLD.mileage_parking_tolls
         OR NEW.reimbursable_amount IS NULL
         OR NEW.reimbursable_amount > v_amount
      THEN
        NEW.reimbursable_amount := v_amount;
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND OLD.mileage_miles IS NOT NULL THEN
    -- It stopped being a mileage entry. The log that stood in for a receipt
    -- is gone with it, so the claim reverts to undocumented unless a real
    -- document has since been attached.
    IF NOT EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = NEW.id) THEN
      NEW.documentation_state := 'none';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.apply_mileage_derived() IS
  'Workstream D6: the mileage arithmetic, in one place. Also marks a mileage
   log as its own documentation.';

DROP TRIGGER IF EXISTS trg_invoices_mileage_documentation ON public.invoices;
DROP TRIGGER IF EXISTS trg_invoices_mileage ON public.invoices;
CREATE TRIGGER trg_invoices_mileage
  BEFORE INSERT OR UPDATE OF mileage_miles, mileage_rate, mileage_parking_tolls
  ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.apply_mileage_derived();

-- The derived display status has to see that. It was scoped to fire only when
-- the three facet columns appeared in the UPDATE's own column list, so a facet
-- changed by another BEFORE trigger -- which is exactly what the trigger above
-- does -- left lifecycle_status describing the previous state. Widened to
-- every update: the body is a CASE over columns already in hand, so there is
-- nothing to save by firing it selectively, and a derived column that is
-- sometimes stale is worse than no derived column at all.
--
-- Named to sort after trg_invoices_mileage so it reads the corrected facets.
DROP TRIGGER IF EXISTS trg_invoices_sync_lifecycle ON public.invoices;
CREATE TRIGGER trg_invoices_sync_lifecycle
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_lifecycle_status();

-- Existing rows: every expense that has a document but says otherwise, and
-- vice versa. This is the backlog the missing trigger accumulated.
UPDATE public.invoices i
   SET documentation_state = 'complete'::expense_documentation_state,
       updated_at = now()
 WHERE i.documentation_state = 'none'
   AND EXISTS (SELECT 1 FROM public.receipts r WHERE r.invoice_id = i.id);

UPDATE public.invoices i
   SET documentation_state = 'none'::expense_documentation_state,
       updated_at = now()
 WHERE i.documentation_state <> 'none'
   AND i.mileage_miles IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.invoice_id = i.id);

-- ── 4. Substantiation status understands mileage ──────────────────────────
-- A mileage expense asked for "a receipt or itemised statement" would be
-- permanently incomplete, chasing paperwork that does not exist. What Pub. 502
-- actually wants for a car trip is the destination and the purpose, so that is
-- what is asked for instead.

CREATE OR REPLACE FUNCTION public.expense_substantiation_status(p_invoice_id UUID)
RETURNS TABLE (
  is_complete       BOOLEAN,
  missing           TEXT[],
  document_count    INTEGER,
  has_service_date  BOOLEAN,
  has_patient       BOOLEAN,
  blocking_gate     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec     RECORD;
  v_docs    INTEGER;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_gate    TEXT;
BEGIN
  SELECT i.user_id, i.service_date, i.patient_id, i.eligibility_state,
         i.ineligible_reason, i.mileage_miles, i.notes
    INTO v_rec
    FROM invoices i WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*) INTO v_docs FROM receipts r WHERE r.invoice_id = p_invoice_id;

  -- Phrased as what the IRS would want to see in an audit, in the order the
  -- user can act on. Not blocking anything -- the spec is explicit that the
  -- documentation note "explains what the IRS would want without blocking
  -- anything else".
  IF v_rec.mileage_miles IS NOT NULL THEN
    -- Pub. 502 substantiates a car trip with a log, not a receipt. Date,
    -- destination and miles are already columns; the purpose of the trip is
    -- the one part that lives in free text.
    IF v_rec.notes IS NULL OR BTRIM(v_rec.notes) = '' THEN
      v_missing := array_append(v_missing, 'what the trip was for');
    END IF;
  ELSIF v_docs = 0 THEN
    v_missing := array_append(v_missing, 'a receipt or itemised statement');
  END IF;

  IF v_rec.service_date IS NULL THEN
    v_missing := array_append(v_missing, 'the date the care happened');
  END IF;
  IF v_rec.patient_id IS NULL THEN
    v_missing := array_append(v_missing, 'who the care was for');
  END IF;

  IF v_rec.eligibility_state = 'ineligible' THEN
    v_gate := v_rec.ineligible_reason;
  ELSIF v_rec.eligibility_state = 'conditional' THEN
    v_gate := 'needs_letter_of_medical_necessity';
  END IF;

  RETURN QUERY SELECT
    (ARRAY_LENGTH(v_missing, 1) IS NULL AND v_gate IS NULL),
    v_missing,
    v_docs,
    (v_rec.service_date IS NOT NULL),
    (v_rec.patient_id IS NOT NULL),
    v_gate;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.expense_substantiation_status(UUID) TO authenticated;
