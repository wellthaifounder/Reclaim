-- Workstream D3 — Gate 2, dependency. And the unification of the gates.
--
-- D1 built expense_dependency_gate, but it only REPORTED: nothing ever marked
-- a non-dependent's expenses ineligible, so the roster answer had no effect on
-- what a user could claim. D3 makes it bite.
--
-- The obvious implementation -- mirror D2's recompute for dependency -- is
-- wrong, and measurably so. There is ONE ineligible_reason column, so two
-- independent bidirectional recomputes each restore expenses the other is
-- still refusing. Verified against this schema before writing any of it:
--
--   * an expense for a non-dependent, for care predating the HSA, fails both
--     gates
--   * the timing recompute blocks it (reason 'pre_establishment')
--   * the user then corrects the roster -- that person IS a tax dependent
--   * the dependency restore fires, knows nothing about the HSA cliff, and
--     returns $500 of care from before the HSA existed to claimable, while
--     expense_timing_gate still reports 'ineligible'
--
-- A user answering an unrelated family question silently re-enabled a claim
-- the IRS would refuse. So eligibility gets ONE writer that evaluates every
-- gate together, and the per-gate functions stay read-only reporters.

-- ── 1. The gates, as one decision ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_blocking_gate_reason(
  p_service_date DATE,
  p_hsa_date     DATE,
  p_qualifies    BOOLEAN
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT CASE
    -- Timing first. It is permanent and nothing the user does can clear it,
    -- so when an expense fails both gates this is the honest thing to show --
    -- telling someone to go fix a roster entry that will not help is worse
    -- than telling them no.
    WHEN p_hsa_date IS NOT NULL
     AND p_service_date IS NOT NULL
     AND p_service_date < p_hsa_date
      THEN 'pre_establishment'
    -- Gate 2. Only a definite FALSE blocks. NULL means the tax-dependency
    -- question has not been answered, which is genuinely undetermined rather
    -- than a refusal -- the expense stays 'unknown', which already keeps it
    -- out of a reimbursement request without asserting something false.
    WHEN p_qualifies IS FALSE
      THEN 'not_tax_dependent'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.expense_blocking_gate_reason(DATE, DATE, BOOLEAN) IS
  'Workstream D3: which gate, if any, refuses this expense. Timing outranks
   dependency because timing can never be fixed. NULL means no gate refuses --
   which is not the same as eligible, since Gate 3 (Pub 502) still applies.';

-- Reasons this system owns and may therefore clear. A Pub 502 refusal from D4
-- is NOT in this set: the gates must never reopen a judgement they did not
-- make.
CREATE OR REPLACE FUNCTION public.gate_owned_reasons()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$ SELECT ARRAY['pre_establishment', 'not_tax_dependent']::TEXT[]; $fn$;

-- ── 2. The single writer ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_expense_eligibility(
  p_user_id UUID,
  -- Restrict to specific expenses when a single roster edit or patient
  -- reassignment is the trigger; NULL means the user's whole history.
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

  -- Block, or correct the reason on something already blocked. The second
  -- case matters: an expense refused for dependency whose date of service is
  -- later corrected to before the HSA must stop saying "not a tax dependent"
  -- and start saying the thing that is now permanently true.
  WITH scoped AS (
    SELECT i.id,
           i.eligibility_state,
           i.ineligible_reason,
           expense_blocking_gate_reason(
             i.effective_service_date, v_hsa, fm.qualifies_for_hsa
           ) AS gate_reason
      FROM invoices i
      LEFT JOIN family_members fm ON fm.id = i.patient_id
     WHERE i.user_id = p_user_id
       AND i.claim_state IN ('unclaimed', 'not_reimbursable')
       AND (p_invoice_ids IS NULL OR i.id = ANY (p_invoice_ids))
  ),
  to_block AS (
    SELECT id, gate_reason FROM scoped
     WHERE gate_reason IS NOT NULL
       AND (eligibility_state <> 'ineligible'
            OR ineligible_reason IS DISTINCT FROM gate_reason)
       -- Never overwrite a refusal this system did not make. An expense
       -- rejected as cosmetic stays rejected as cosmetic.
       AND (eligibility_state <> 'ineligible'
            OR ineligible_reason = ANY (gate_owned_reasons())
            OR ineligible_reason IS NULL)
  )
  UPDATE invoices i
     SET eligibility_state = 'ineligible',
         ineligible_reason = b.gate_reason,
         updated_at        = now()
    FROM to_block b
   WHERE i.id = b.id;

  GET DIAGNOSTICS v_blocked = ROW_COUNT;

  -- Restore only when EVERY gate passes. This is the half the naive
  -- two-function design got wrong.
  --
  -- Restored to 'unknown', never 'eligible': clearing the gates does not make
  -- an expense qualified, it only stops disqualifying it. Gate 3 still runs.
  WITH scoped AS (
    SELECT i.id,
           i.ineligible_reason,
           expense_blocking_gate_reason(
             i.effective_service_date, v_hsa, fm.qualifies_for_hsa
           ) AS gate_reason
      FROM invoices i
      LEFT JOIN family_members fm ON fm.id = i.patient_id
     WHERE i.user_id = p_user_id
       AND i.eligibility_state = 'ineligible'
       AND i.claim_state IN ('unclaimed', 'not_reimbursable')
       AND (p_invoice_ids IS NULL OR i.id = ANY (p_invoice_ids))
  )
  UPDATE invoices i
     SET eligibility_state = 'unknown',
         ineligible_reason = NULL,
         updated_at        = now()
    FROM scoped s
   WHERE i.id = s.id
     AND s.gate_reason IS NULL
     AND s.ineligible_reason = ANY (gate_owned_reasons());

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RETURN QUERY SELECT v_blocked, v_restored;
END;
$fn$;

COMMENT ON FUNCTION public.recompute_expense_eligibility(UUID, UUID[]) IS
  'Workstream D3: the single writer of gate-driven eligibility. Evaluates
   timing and dependency together so neither can reopen what the other
   refuses. Restores only when every gate passes.';

-- D2 shipped this name and two call sites use it. Kept as a delegating
-- wrapper rather than left in place: an independent timing-only recompute is
-- precisely the thing that could undo a dependency refusal.
CREATE OR REPLACE FUNCTION public.recompute_timing_eligibility(p_user_id UUID)
RETURNS TABLE (blocked INTEGER, restored INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT * FROM public.recompute_expense_eligibility(p_user_id, NULL);
$fn$;

COMMENT ON FUNCTION public.recompute_timing_eligibility(UUID) IS
  'Workstream D2, superseded by D3. Delegates to recompute_expense_eligibility
   so a timing recompute cannot reopen a dependency refusal.';

-- ── 3. Keep it current ────────────────────────────────────────────────────

-- Replaces the D2 trigger, which considered timing alone. Firing on
-- patient_id as well means reassigning an expense to a different family
-- member re-runs both gates.
CREATE OR REPLACE FUNCTION public.apply_expense_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hsa       DATE;
  v_new_eff   DATE;
  v_qualifies BOOLEAN;
  v_reason    TEXT;
BEGIN
  -- COALESCE by hand: Postgres computes generated columns AFTER before-row
  -- triggers, so NEW.effective_service_date reads NULL here. The D2 version of
  -- this trigger read it and every branch silently evaluated to NULL, so
  -- correcting a date of service moved nothing.
  v_new_eff := COALESCE(NEW.service_date, NEW.date);

  IF NEW.claim_state NOT IN ('unclaimed', 'not_reimbursable') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_new_eff IS NOT DISTINCT FROM OLD.effective_service_date
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id THEN
    RETURN NEW;
  END IF;

  v_hsa := hsa_establishment_date(NEW.user_id);

  SELECT fm.qualifies_for_hsa INTO v_qualifies
    FROM family_members fm WHERE fm.id = NEW.patient_id;

  v_reason := expense_blocking_gate_reason(v_new_eff, v_hsa, v_qualifies);

  IF v_reason IS NOT NULL THEN
    IF NEW.eligibility_state <> 'ineligible'
       OR NEW.ineligible_reason = ANY (gate_owned_reasons())
       OR NEW.ineligible_reason IS NULL THEN
      NEW.eligibility_state := 'ineligible';
      NEW.ineligible_reason := v_reason;
    END IF;
  ELSIF NEW.eligibility_state = 'ineligible'
        AND NEW.ineligible_reason = ANY (gate_owned_reasons()) THEN
    NEW.eligibility_state := 'unknown';
    NEW.ineligible_reason := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoices_timing_gate ON public.invoices;
DROP TRIGGER IF EXISTS trg_invoices_expense_gates ON public.invoices;
CREATE TRIGGER trg_invoices_expense_gates
  BEFORE UPDATE OF service_date, date, patient_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.apply_expense_gates();

-- The roster answer is the whole point of Gate 2, so answering it has to reach
-- the expenses. Without this the user ticks "yes, I claim them" and nothing
-- they can see changes until some unrelated action happens to recompute.
CREATE OR REPLACE FUNCTION public.propagate_dependency_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ids UUID[];
BEGIN
  IF NEW.qualifies_for_hsa IS NOT DISTINCT FROM OLD.qualifies_for_hsa THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY_AGG(i.id) INTO v_ids
    FROM invoices i WHERE i.patient_id = NEW.id;

  IF v_ids IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deliberately routed through the same single writer rather than updating
  -- the rows directly, so a roster edit cannot reopen an expense the timing
  -- gate still refuses.
  PERFORM public.recompute_expense_eligibility(NEW.user_id, v_ids);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_family_members_dependency ON public.family_members;
CREATE TRIGGER trg_family_members_dependency
  AFTER UPDATE OF tax_dependent, relationship ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.propagate_dependency_change();

-- ── 4. All gates in one read ──────────────────────────────────────────────
-- The UI shows the gates together, so it should not need a round trip each.

CREATE OR REPLACE FUNCTION public.expense_eligibility_gates(p_invoice_id UUID)
RETURNS TABLE (
  gate           TEXT,   -- 'timing' | 'dependency'
  status         TEXT,   -- 'eligible' | 'ineligible' | 'unknown'
  reason         TEXT,
  is_blocking    BOOLEAN,
  is_permanent   BOOLEAN
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
           -- Timing is the only gate a user can never act on. Saying so is
           -- what stops them attaching more documents to a lost cause.
           TRUE
      FROM expense_timing_gate(p_invoice_id) t
    UNION ALL
    SELECT 'dependency'::TEXT, d.status, d.reason,
           (d.status = 'ineligible'),
           FALSE
      FROM expense_dependency_gate(p_invoice_id) d;
END;
$fn$;

COMMENT ON FUNCTION public.expense_eligibility_gates(UUID) IS
  'Workstream D3: every eligibility gate for one expense, in one call.
   Read-only -- recompute_expense_eligibility is the only writer.';

GRANT EXECUTE ON FUNCTION public.expense_blocking_gate_reason(DATE, DATE, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_expense_eligibility(UUID, UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_eligibility_gates(UUID) TO authenticated;

-- ── 5. Apply Gate 2 to existing history ───────────────────────────────────
-- D1 linked expenses to roster members but nothing ever acted on the answer,
-- so anyone who has already marked a family member as not a tax dependent has
-- claimable expenses that should not be.

DO $$
DECLARE
  v_blocked INTEGER;
BEGIN
  WITH gated AS (
    SELECT i.id,
           expense_blocking_gate_reason(
             i.effective_service_date,
             hsa_establishment_date(i.user_id),
             fm.qualifies_for_hsa
           ) AS gate_reason,
           i.eligibility_state,
           i.ineligible_reason
      FROM invoices i
      JOIN family_members fm ON fm.id = i.patient_id
     WHERE i.claim_state IN ('unclaimed', 'not_reimbursable')
       AND fm.qualifies_for_hsa IS FALSE
  )
  UPDATE invoices i
     SET eligibility_state = 'ineligible',
         ineligible_reason = g.gate_reason,
         updated_at        = now()
    FROM gated g
   WHERE i.id = g.id
     AND g.gate_reason IS NOT NULL
     AND (g.eligibility_state <> 'ineligible'
          OR g.ineligible_reason IS NULL
          OR g.ineligible_reason = ANY (gate_owned_reasons()));

  GET DIAGNOSTICS v_blocked = ROW_COUNT;
  RAISE NOTICE 'Gate 2 backfill: % expense(s) blocked for a non-dependent patient.', v_blocked;
END
$$;
