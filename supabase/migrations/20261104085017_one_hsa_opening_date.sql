-- L2 (docs/V1_LAUNCH_PLAN.md, Batch 1): one HSA opening date.
--
-- `profiles.hsa_opened_date` is the date that counts. Before this migration
-- there were two, and different readers picked different ones:
--
--   * onboarding and the "when did you open your HSA?" dialog wrote
--     profiles.hsa_opened_date;
--   * the HSA-account form in Settings wrote hsa_accounts.opened_date;
--   * the setup checklist (and the Transactions banner, and HSAContext) read
--     only the profile, so adding an account in Settings never satisfied it;
--   * the timing gate, hsa_establishment_date(), read the accounts first and
--     fell back to the profile -- so where both existed, the date a user had
--     typed into onboarding was silently ignored.
--
-- Now: saving, editing or deleting an HSA account writes the earliest date
-- across the user's accounts into the profile (trigger below), and the timing
-- gate reads the profile only. A later HSA funded by rolling over an earlier
-- one counts as opened on the earlier date, so the earliest is the right
-- default.
--
-- "Earliest" is measured exactly as hsa_establishment_date() measured it until
-- now -- COALESCE(eligibility_start_date, opened_date) -- so that switching the
-- gate to the profile changes no one's cliff. Measuring opened_date alone
-- would have moved the cliff later for anyone who recorded an earlier
-- eligibility start, and blocked expenses that are claimable today.
--
-- Recomputing expense eligibility after the date moves is the app's job, not
-- this trigger's: recompute_expense_eligibility() refuses any caller other
-- than the signed-in owner, and an account row is also deleted by the cascade
-- when a user is deleted, where there is no signed-in owner. The app already
-- recomputes after every other HSA-date write (onboarding, the dialog), and
-- now does so after an account save too (useHSAAccounts).
--
-- Because that recompute now runs on every account add, edit and delete, two
-- gaps in it matter much more than they did, and are closed here (sections 4
-- and 5): an expense the user had confirmed, once blocked by the HSA date, was
-- never given back when the date moved earlier again; and a user's own "not
-- eligible" decision could be relabelled by the HSA date, which made it
-- impossible to give back the first kind safely.

-- ── 1. Keep the profile in step with the accounts ────────────────────────

CREATE OR REPLACE FUNCTION public.sync_profile_hsa_opened_date()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY DEFINER because the account rows are not always deleted by their
-- owner. "Delete my account" (delete-user-account -> auth.admin.deleteUser)
-- runs as Supabase's auth login, supabase_auth_admin, whose cascade removes
-- hsa_accounts rows and fires this trigger as that login -- which may neither
-- read hsa_accounts nor update profiles, so the whole account deletion rolled
-- back for anyone with an HSA account. Elevated rights are safe here: the only
-- row it writes is the profile of the account row's owner, hsa_accounts RLS
-- already pins that owner to auth.uid() for every signed-in writer, and the
-- check below refuses anything else regardless.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user     UUID;
  v_earliest DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user := OLD.user_id;
  ELSE
    v_user := NEW.user_id;
  END IF;

  -- A signed-in caller only ever moves their own date. (auth.uid() is NULL
  -- for the auth login's cascade and for service-role work, both trusted.)
  IF auth.uid() IS NOT NULL AND v_user IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;

  SELECT MIN(COALESCE(a.eligibility_start_date, a.opened_date))
    INTO v_earliest
    FROM hsa_accounts a
   WHERE a.user_id = v_user;

  -- Deleting the last account leaves the profile's date where it was rather
  -- than blanking it. A blank date silently stops the timing gate (see
  -- recompute_expense_eligibility), and removing an account record is not a
  -- statement that the user never had an HSA.
  IF v_earliest IS NULL THEN
    RETURN NULL;
  END IF;

  -- An account's date was typed as a real date, so it is not a guess even if
  -- it happens to equal a January 1 estimate from onboarding.
  UPDATE profiles p
     SET hsa_opened_date             = v_earliest,
         hsa_opened_date_is_estimate = FALSE
   WHERE p.id = v_user
     AND (p.hsa_opened_date IS DISTINCT FROM v_earliest
          OR p.hsa_opened_date_is_estimate);

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.sync_profile_hsa_opened_date() IS
  'L2: after any change to a user''s HSA accounts, write the earliest
   COALESCE(eligibility_start_date, opened_date) into profiles.hsa_opened_date,
   the one HSA opening date the app reads. Leaves the date alone when the last
   account is deleted. Runs with its owner''s rights so account deletion by
   the auth login can cascade through it; a signed-in caller can only move
   their own date.';

DROP TRIGGER IF EXISTS trg_hsa_accounts_sync_profile_date ON public.hsa_accounts;
CREATE TRIGGER trg_hsa_accounts_sync_profile_date
  AFTER INSERT OR DELETE OR UPDATE OF opened_date, eligibility_start_date, user_id
  ON public.hsa_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_hsa_opened_date();

-- ── 2. Bring existing profiles into line ─────────────────────────────────
--
-- For every user who has accounts, the profile takes the date the timing gate
-- was already using for them, so step 3 changes nobody's cliff. No expense is
-- recomputed here on purpose: the next HSA-date save does that, in the app,
-- with the user told what moved.

UPDATE public.profiles p
   SET hsa_opened_date             = e.earliest,
       hsa_opened_date_is_estimate = FALSE
  FROM (
    SELECT a.user_id,
           MIN(COALESCE(a.eligibility_start_date, a.opened_date)) AS earliest
      FROM public.hsa_accounts a
     GROUP BY a.user_id
  ) e
 WHERE p.id = e.user_id
   AND (p.hsa_opened_date IS DISTINCT FROM e.earliest
        OR p.hsa_opened_date_is_estimate);

-- ── 3. The timing gate reads the one date, and only the owner's ──────────

CREATE OR REPLACE FUNCTION public.hsa_establishment_date(p_user_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  -- L2: the profile is the one HSA opening date. It already holds the
  -- earliest account date (trigger above), and reading it alone means a date
  -- typed into onboarding or the dialog is no longer overruled by an account
  -- row the user may have forgotten about.
  --
  -- Only the owner's. This was SECURITY DEFINER with no ownership check and
  -- executable by anyone holding the public key, so any user's HSA date could
  -- be read given their id. A signed-in caller asking about someone else now
  -- gets NULL. auth.uid() is NULL for trusted callers -- service-role bank
  -- imports firing the invoice gate trigger, the postgres owner -- and they
  -- still get the date.
  SELECT p.hsa_opened_date
    FROM profiles p
   WHERE p.id = p_user_id
     AND (auth.uid() IS NULL OR auth.uid() = p_user_id);
$fn$;

COMMENT ON FUNCTION public.hsa_establishment_date(UUID) IS
  'L2: the earliest date from which this user may pay medical expenses with
   HSA money -- profiles.hsa_opened_date, which saving an HSA account keeps at
   the earliest account date. NULL when they have not told us yet, and NULL
   for a signed-in caller asking about another user.';

REVOKE EXECUTE ON FUNCTION public.hsa_establishment_date(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hsa_establishment_date(UUID) TO authenticated, service_role;

-- ── 4. Give back what the HSA date took from a confirmed expense ─────────
--
-- Redefined from its latest definition (20260905120000_receipt_invoices_
-- join_table.sql); two changes, both marked L2.
--
-- (a) RESTORE. The refuse step lets the HSA-date rule (a fact) overrule a
--     confirmed expense, but the stand-aside step skips every confirmed
--     expense, so once the date moved back the expense stayed "can never be
--     reimbursed" for good. With the recompute now running after every HSA
--     account save, the common path to that was: confirm 2019-2022 expenses,
--     add only a newer rolled-over HSA opened in 2023, then add the 2019 one.
--     A confirmed expense the HSA date blocked now goes back to 'eligible',
--     which is what the user had confirmed -- unless another factual gate
--     (not a tax dependent) now refuses it. Expenses blocked for any other
--     reason are untouched.
--
-- (b) NEVER RELABEL A USER'S "NO". confirmed_at is stamped for both of the
--     user's decisions, "eligible" and "not eligible", and nothing else
--     records which one it was. The refuse step used to relabel a confirmed
--     "not eligible" expense (reason NULL, or the list's reason the user
--     agreed with) as 'pre_establishment', after which (a) would have turned
--     the user's "no" into "eligible". A confirmed expense that is already
--     ineligible is now left exactly as it is -- it is not claimable either
--     way -- so a confirmed expense can only carry 'pre_establishment' if it
--     was a "yes" when the date blocked it.

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
  v_hsa                DATE;
  v_blocked            INTEGER := 0;
  v_restored           INTEGER := 0;
  v_restored_confirmed INTEGER := 0;
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
        SELECT 1 FROM receipt_invoices ri
        JOIN receipts r ON r.id = ri.receipt_id
         WHERE ri.invoice_id = i.id
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
     AND (t.confirmed_at IS NULL OR t.is_factual_refusal)
     -- L2 (b): a confirmed expense that is already ineligible is the user's
     -- own "no" (or already refused); relabelling it would let the restore
     -- below turn that "no" into "eligible". Only the HSA date's own label
     -- may be replaced, by the next fact in line.
     AND NOT (t.confirmed_at IS NOT NULL
              AND t.current_state = 'ineligible'
              AND t.current_reason IS DISTINCT FROM 'pre_establishment');

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

  -- L2 (a): the confirmed expenses the HSA date blocked. By (b), each was a
  -- "yes" when it was blocked, so it goes back to 'eligible' -- the user's own
  -- determination, which Gate 3 and a missing letter never overrule -- unless
  -- a fact (not a tax dependent) now refuses it instead, which the refuse
  -- step above has already relabelled.
  UPDATE invoices i
     SET eligibility_state = 'eligible',
         ineligible_reason = NULL,
         updated_at        = now()
    FROM _verdicts t
   WHERE i.id = t.id
     AND t.confirmed_at IS NOT NULL
     AND t.current_state = 'ineligible'
     AND t.current_reason = 'pre_establishment'
     AND NOT (t.want_state = 'ineligible' AND t.is_factual_refusal);

  GET DIAGNOSTICS v_restored_confirmed = ROW_COUNT;
  v_restored := v_restored + v_restored_confirmed;

  DROP TABLE IF EXISTS _verdicts;
  RETURN QUERY SELECT v_blocked, v_restored;
END;
$fn$;

-- ── 5. The same two rules when a date of service is edited ───────────────
--
-- The invoice trigger applies gates 1 and 2 when an expense's date or patient
-- changes. Redefined from its latest definition (20260816180000_dependency_
-- gate.sql) with the same two L2 changes as section 4, for the same reasons:
-- it too relabelled a confirmed "not eligible" expense as 'pre_establishment'
-- (which would make section 4 (a) unsafe), and it restored a confirmed
-- expense to 'unknown' rather than to the "eligible" the user had confirmed.

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
    IF (NEW.eligibility_state <> 'ineligible'
        OR NEW.ineligible_reason = ANY (gate_owned_reasons())
        OR NEW.ineligible_reason IS NULL)
       -- L2: never relabel the user's own confirmed "no" (section 4 (b)).
       AND NOT (NEW.confirmed_at IS NOT NULL
                AND NEW.eligibility_state = 'ineligible'
                AND NEW.ineligible_reason IS DISTINCT FROM 'pre_establishment') THEN
      NEW.eligibility_state := 'ineligible';
      NEW.ineligible_reason := v_reason;
    END IF;
  ELSIF NEW.eligibility_state = 'ineligible'
        AND NEW.ineligible_reason = ANY (gate_owned_reasons()) THEN
    -- L2: a confirmed expense the HSA date blocked goes back to the "eligible"
    -- the user confirmed (section 4 (a)); anything else to 'unknown'.
    IF NEW.confirmed_at IS NOT NULL
       AND NEW.ineligible_reason = 'pre_establishment' THEN
      NEW.eligibility_state := 'eligible';
    ELSE
      NEW.eligibility_state := 'unknown';
    END IF;
    NEW.ineligible_reason := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;
