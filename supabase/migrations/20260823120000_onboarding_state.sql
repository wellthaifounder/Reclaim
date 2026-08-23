-- Step 0 — "Connect first, configure second".
--
-- From the workflow spec, Step 0: "asking for HSA establishment date and family
-- roster before showing any value is the highest drop-off point in the funnel.
-- Connect accounts -> run the historical lookback -> show 'We found 47 likely-
-- medical transactions totalling $3,240' -> THEN collect the details needed to
-- act on them."
--
-- Two columns, for two things the app currently cannot answer.
--
-- 1. Has this person been through setup?
--
--    Onboarding state lived in localStorage under `wellth_onboarding_state`,
--    which is per-browser. Sign in on a phone after setting up on a laptop and
--    the app believes you are brand new; clear site data and it forgets you
--    ever configured anything. Worse, the three components that read it
--    (OnboardingWizard, WelcomeDialog, EmptyStateOnboarding) were not rendered
--    by anything, so in practice there was no onboarding at all -- a new user
--    landed on an empty dashboard with two manual-entry buttons and no prompt
--    to connect a bank, in a product whose entire premise is bank sync.
--
-- 2. Is the HSA establishment date something they actually knew?
--
--    The date is a hard cliff: care received one day before it is never
--    eligible, ever. Most people do not know theirs. The spec requires an
--    "I'm not sure" path, and an estimate that cannot be distinguished from a
--    confirmed date is a silent audit risk -- so we record which one it is.

-- ── 1. Onboarding completion ──────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.onboarding_completed_at IS
  'When this user finished (or dismissed) Step 0 setup. NULL means they have
   not been through it and /dashboard should route them to /welcome. Server-
   side on purpose: the localStorage flag it replaces was per-browser, so the
   same person got re-onboarded on every new device.';

-- ── 2. Was the HSA date a guess? ──────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hsa_opened_date_is_estimate BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.hsa_opened_date_is_estimate IS
  'TRUE when the user answered "I''m not sure" and picked a year rather than a
   date, in which case hsa_opened_date is January 1 of that year. That is the
   permissive end of the year: it lets expenses through that a later, real
   establishment date might exclude. Surface it as a warning wherever the
   timing gate is reported, and prompt for confirmation before a claim is
   filed on the strength of it.';

-- Correcting the date by hand means it is no longer a guess. Without this,
-- someone who fixed their date in Settings would carry the "this is an
-- estimate" warning forever and have no way to clear it.
CREATE OR REPLACE FUNCTION public.clear_hsa_date_estimate_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Only an explicit change to the date clears the flag. An UPDATE that sets
  -- the same value again (a form resubmit) is not a confirmation of anything.
  IF NEW.hsa_opened_date IS DISTINCT FROM OLD.hsa_opened_date
     AND NEW.hsa_opened_date_is_estimate IS NOT DISTINCT FROM OLD.hsa_opened_date_is_estimate
  THEN
    NEW.hsa_opened_date_is_estimate := FALSE;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_clear_hsa_estimate ON public.profiles;
CREATE TRIGGER trg_profiles_clear_hsa_estimate
  BEFORE UPDATE OF hsa_opened_date ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.clear_hsa_date_estimate_flag();

-- ── 3. Every new user starts on their own roster ──────────────────────────
--
-- Found by walking the new welcome flow with a freshly signed-up account: the
-- household step rendered an empty roster, with no "Me" row.
--
-- The family-roster migration (20260816140000) backfilled a 'self' member for
-- every profile that existed at the time, but nothing creates one for a user
-- who signs up afterwards -- handle_new_user only ever inserted the profile
-- row. So every account created since 16 August has an empty roster, and the
-- patient picker on the substantiation step opens with nothing to choose, not
-- even the account holder. Substantiating your own expense, which is the
-- commonest case in the product, had no valid selection.
--
-- The name is a placeholder the user can rename; what matters is that the row
-- exists and that qualifies_for_hsa is TRUE for it, which the generated column
-- derives from relationship = 'self' regardless of the flag.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Was `SET search_path = public`. pg_temp must be pinned too, or a caller can
-- shadow an unqualified name with a temp object (CLAUDE.md, database rules).
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_name TEXT;
BEGIN
  -- family_members.name is NOT NULL with a non-blank CHECK, so an empty
  -- full_name has to become a placeholder rather than being passed through.
  -- Either way the user can rename it, and the rename reaches their expenses
  -- by trigger.
  v_name := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(v_name, ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.family_members (user_id, name, relationship, tax_dependent)
  VALUES (NEW.id, COALESCE(v_name, 'Me'), 'self', TRUE)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$fn$;

-- Catch up the accounts created between the roster migration and this one.
INSERT INTO public.family_members (user_id, name, relationship, tax_dependent)
SELECT p.id, COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Me'), 'self', TRUE
  FROM public.profiles p
 WHERE NOT EXISTS (
   SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = p.id AND fm.relationship = 'self'
 )
ON CONFLICT DO NOTHING;

-- ── 4. Backfill ───────────────────────────────────────────────────────────
--
-- Everyone who already has a profile is marked complete. Reclaim has not
-- launched, so this is a handful of development and demo accounts -- but the
-- rule would be the same at any size: a flow designed for someone's first
-- five minutes must never ambush someone who has been using the app for
-- months. New users get NULL and see /welcome; existing users are left where
-- they are.
--
-- To walk the flow yourself, Settings -> "Replay setup" clears this column.

UPDATE public.profiles
   SET onboarding_completed_at = COALESCE(created_at, now())
 WHERE onboarding_completed_at IS NULL;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM profiles WHERE onboarding_completed_at IS NOT NULL;
  RAISE NOTICE 'Onboarding backfill: % existing profile(s) marked complete.', v_count;
END
$$;
