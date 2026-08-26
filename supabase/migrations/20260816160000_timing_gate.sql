-- Workstream D2 — Gate 1, timing.
--
-- From the workflow spec: "Date of service must be on or after the HSA
-- establishment date. A hard cliff: one day early is never eligible, ever.
-- Computed automatically; the user is told, with the reason shown."
--
-- Three separate defects are fixed here, and the first is the serious one.
--
-- 1. THE GATE HAD STOPPED FIRING. Both call sites (Settings and
--    SetHSADateDialog) mark pre-establishment expenses ineligible with
--
--      .lt("date", hsaDate).eq("is_hsa_eligible", true)
--
--    `is_hsa_eligible` is a GENERATED column meaning eligibility_state =
--    'eligible'. Since Workstream B/C2 every auto-captured and manually
--    entered expense starts at 'unknown', so the filter matches almost
--    nothing. Measured against this schema: of three expenses predating the
--    HSA, only the one already marked eligible was caught -- $500 of spending
--    from before the account existed stayed claimable.
--
-- 2. IT WAS ONE-DIRECTIONAL. Marking happened on save and was never undone. A
--    user who mistyped 2024 instead of 2014, then corrected it, kept a decade
--    of correctly-claimable expenses permanently marked ineligible with no way
--    back. For a hard cliff that is worse than not running at all: the error
--    is invisible and the money is simply gone from their totals.
--
-- 3. IT KEYED ON THE WRONG DATE. The IRS ties an expense to the DATE OF
--    SERVICE, not the date of payment. A December visit paid in January is a
--    December expense. Against an establishment cliff those are different
--    answers, and bank sync only ever knows the payment date.
--
-- The fix for (1) and (2) together is to stop treating this as a one-time
-- write and make it a recomputation that runs in both directions.

-- ── 1. Date of service ────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS service_date DATE;

COMMENT ON COLUMN public.invoices.service_date IS
  'Workstream D2: when care was received, which is what the IRS ties an
   expense to. Distinct from `date`, the day money moved -- bank sync can only
   ever know the latter. NULL means not yet established.';

-- Generated rather than back-filled, so the fallback is stated once and every
-- reader agrees. The payment date is a defensible stand-in: for the large
-- majority of transactions they are the same day, and where they differ the
-- payment is later, which fails SAFE against the cliff rather than claiming
-- something too early.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS effective_service_date DATE
  GENERATED ALWAYS AS (COALESCE(service_date, date)) STORED;

COMMENT ON COLUMN public.invoices.effective_service_date IS
  'Date of service if known, else the payment date. The date every timing
   check and tax-year assignment reads.';

CREATE INDEX IF NOT EXISTS idx_invoices_effective_service_date
  ON public.invoices (user_id, effective_service_date);

-- ── 2. When the user's HSA became usable ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.hsa_establishment_date(p_user_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    -- The multi-account table is authoritative where it has rows. Earliest
    -- wins: once ANY HSA existed, expenses from that day forward can be paid
    -- from HSA money, including from an account opened later. Publication 969
    -- treats the establishment date as a property of the person, not of the
    -- particular account the money sits in.
    (
      SELECT MIN(COALESCE(a.eligibility_start_date, a.opened_date))
        FROM hsa_accounts a
       WHERE a.user_id = p_user_id
    ),
    -- Legacy single-date field, still the only source for most users.
    (SELECT p.hsa_opened_date FROM profiles p WHERE p.id = p_user_id)
  );
$fn$;

COMMENT ON FUNCTION public.hsa_establishment_date(UUID) IS
  'Workstream D2: the earliest date from which this user may pay medical
   expenses with HSA money. NULL when they have not told us yet.';

-- ── 3. Gate 1 ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_timing_gate(p_invoice_id UUID)
RETURNS TABLE (
  status             TEXT,   -- 'eligible' | 'ineligible' | 'unknown'
  service_date       DATE,
  establishment_date DATE,
  uses_payment_date  BOOLEAN,
  reason             TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec   RECORD;
  v_hsa   DATE;
BEGIN
  SELECT i.user_id, i.effective_service_date, i.service_date, i.date
    INTO v_rec
    FROM invoices i
   WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_hsa := hsa_establishment_date(v_rec.user_id);

  IF v_hsa IS NULL THEN
    RETURN QUERY SELECT
      'unknown'::TEXT, v_rec.effective_service_date, NULL::DATE,
      (v_rec.service_date IS NULL),
      'Tell us when you opened your HSA and we can check this. Expenses from before that date can never be reimbursed, so it changes what you can claim.'::TEXT;
    RETURN;
  END IF;

  IF v_rec.effective_service_date < v_hsa THEN
    RETURN QUERY SELECT
      'ineligible'::TEXT, v_rec.effective_service_date, v_hsa,
      (v_rec.service_date IS NULL),
      -- Says plainly that this is final. Users repeatedly try to fix an
      -- ineligible expense by adding documents, and no amount of paperwork
      -- moves this one.
      'This care happened on ' || TO_CHAR(v_rec.effective_service_date, 'Mon DD, YYYY')
      || ', before your HSA was opened on ' || TO_CHAR(v_hsa, 'Mon DD, YYYY')
      || '. HSA money can only pay for care received on or after that date, so this one can never be reimbursed.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'eligible'::TEXT, v_rec.effective_service_date, v_hsa,
    (v_rec.service_date IS NULL),
    CASE
      WHEN v_rec.service_date IS NULL THEN
        'This is after your HSA was opened. We are using the payment date of '
        || TO_CHAR(v_rec.date, 'Mon DD, YYYY')
        || ' — if the care happened earlier, tell us, because the IRS goes by when you were treated.'
      ELSE
        'Care received on ' || TO_CHAR(v_rec.effective_service_date, 'Mon DD, YYYY')
        || ', after your HSA was opened.'
    END::TEXT;
END;
$fn$;

COMMENT ON FUNCTION public.expense_timing_gate(UUID) IS
  'Workstream D2, Gate 1: was this care received on or after the HSA
   establishment date? Reported, never asked. Reads date of service.';

-- ── 4. Recomputation, in both directions ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_timing_eligibility(p_user_id UUID)
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
    RAISE EXCEPTION 'recompute_timing_eligibility requires a user id';
  END IF;
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_hsa := hsa_establishment_date(p_user_id);

  IF v_hsa IS NULL THEN
    -- Nothing to test against. Deliberately not treated as "block
    -- everything": a user who has not yet entered their HSA date has not told
    -- us anything is wrong, and disqualifying their whole history on a blank
    -- field would be alarming and false.
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Block. Note there is no is_hsa_eligible filter: that generated column is
  -- what made the previous implementation a no-op, since expenses default to
  -- eligibility_state 'unknown' and were therefore invisible to it.
  UPDATE invoices
     SET eligibility_state  = 'ineligible',
         ineligible_reason  = 'pre_establishment',
         updated_at         = now()
   WHERE user_id = p_user_id
     AND effective_service_date < v_hsa
     AND eligibility_state <> 'ineligible'
     -- An expense inside a submitted request is part of an immutable record.
     -- Rewriting it would contradict a document already sent to a custodian.
     AND claim_state IN ('unclaimed', 'not_reimbursable');

  GET DIAGNOSTICS v_blocked = ROW_COUNT;

  -- Restore. This half did not exist before, and its absence made a mistyped
  -- HSA date permanent and invisible. Only 'pre_establishment' is reversed --
  -- an expense ineligible for a Pub 502 reason is not this gate's to reopen.
  --
  -- Restored to 'unknown', never to 'eligible': clearing the timing objection
  -- does not make something qualified, it only stops disqualifying it. The
  -- remaining gates still have to run.
  UPDATE invoices
     SET eligibility_state  = 'unknown',
         ineligible_reason  = NULL,
         updated_at         = now()
   WHERE user_id = p_user_id
     AND effective_service_date >= v_hsa
     AND eligibility_state = 'ineligible'
     AND ineligible_reason = 'pre_establishment'
     AND claim_state IN ('unclaimed', 'not_reimbursable');

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RETURN QUERY SELECT v_blocked, v_restored;
END;
$fn$;

COMMENT ON FUNCTION public.recompute_timing_eligibility(UUID) IS
  'Workstream D2: re-apply the establishment-date cliff across a user''s
   expenses, blocking AND restoring. Run whenever the HSA date changes -- a
   corrected date must give back what a wrong one took away.';

-- Setting service_date on an expense can move it across the cliff in either
-- direction, so the same recomputation has to follow the edit. Doing it in a
-- trigger rather than at each call site means the substantiation screen, the
-- OCR path and any future editor all get it without remembering to.
CREATE OR REPLACE FUNCTION public.apply_timing_gate_on_service_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hsa       DATE;
  v_new_eff   DATE;
BEGIN
  -- COALESCE by hand rather than reading NEW.effective_service_date.
  -- Postgres computes generated columns AFTER before-row triggers, so the
  -- generated column reads NULL here while OLD (an already-stored row) reads
  -- fine. The first version of this trigger compared the two and every branch
  -- silently evaluated to NULL, so correcting a date of service moved nothing
  -- across the cliff. Verified with a probe trigger: NEW.effective_service_date
  -- was <NULL> while NEW.service_date held the new value.
  v_new_eff := COALESCE(NEW.service_date, NEW.date);

  IF v_new_eff IS NOT DISTINCT FROM OLD.effective_service_date THEN
    RETURN NEW;
  END IF;
  IF NEW.claim_state NOT IN ('unclaimed', 'not_reimbursable') THEN
    RETURN NEW;
  END IF;

  v_hsa := hsa_establishment_date(NEW.user_id);
  IF v_hsa IS NULL OR v_new_eff IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_new_eff < v_hsa AND NEW.eligibility_state <> 'ineligible' THEN
    NEW.eligibility_state := 'ineligible';
    NEW.ineligible_reason := 'pre_establishment';
  ELSIF v_new_eff >= v_hsa
        AND NEW.eligibility_state = 'ineligible'
        AND NEW.ineligible_reason = 'pre_establishment' THEN
    NEW.eligibility_state := 'unknown';
    NEW.ineligible_reason := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoices_timing_gate ON public.invoices;
CREATE TRIGGER trg_invoices_timing_gate
  BEFORE UPDATE OF service_date, date ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.apply_timing_gate_on_service_date();

GRANT EXECUTE ON FUNCTION public.hsa_establishment_date(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_timing_gate(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_timing_eligibility(UUID) TO authenticated;
