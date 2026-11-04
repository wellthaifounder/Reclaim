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

-- ── 1. Keep the profile in step with the accounts ────────────────────────

CREATE OR REPLACE FUNCTION public.sync_profile_hsa_opened_date()
RETURNS TRIGGER
LANGUAGE plpgsql
-- Runs as the caller, not SECURITY DEFINER: the account row it reacts to is
-- already the caller's own (hsa_accounts RLS), and "Users can update their own
-- profile" covers the write.
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
   account is deleted.';

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

-- ── 3. The timing gate reads the one date ────────────────────────────────

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
  SELECT p.hsa_opened_date FROM profiles p WHERE p.id = p_user_id;
$fn$;

COMMENT ON FUNCTION public.hsa_establishment_date(UUID) IS
  'L2: the earliest date from which this user may pay medical expenses with
   HSA money -- profiles.hsa_opened_date, which saving an HSA account keeps at
   the earliest account date. NULL when they have not told us yet.';
