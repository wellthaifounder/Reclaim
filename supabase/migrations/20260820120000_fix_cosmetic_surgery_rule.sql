-- Cosmetic surgery is conditional, not flatly ineligible.
--
-- The rule's own `conditions` text has always said the right thing:
--
--   "Not qualified when it merely improves appearance. Qualified when it
--    corrects a congenital abnormality, a disfiguring disease, or an injury
--    from an accident or trauma."
--
-- ...but its `eligibility_status` said `ineligible`, and the status is the
-- field that acts. The classifier reads it, the review queue shows it, and
-- Substantiation Records exclude anything carrying it. So reconstructive
-- surgery after an accident or a mastectomy -- genuinely qualified under
-- Pub 502, and often one of the largest single expenses a user will ever
-- have -- was being ruled out automatically, with the correct explanation
-- sitting right next to the wrong verdict.
--
-- IRS Publication 502, "Cosmetic Surgery": you generally cannot include the
-- cost of a procedure directed at improving appearance and which does not
-- meaningfully promote the proper function of the body or prevent or treat
-- illness or disease. You CAN include it if it is necessary to improve a
-- deformity arising from, or directly related to, a congenital abnormality,
-- a personal injury from an accident or trauma, or a disfiguring disease.
--
-- `conditional` is exactly that shape: the app asks the user for the
-- supporting document instead of silently allowing or silently denying.
--
-- This was found while retiring the standalone HSA eligibility reference
-- page, which carried a second, independently maintained list of Pub 502
-- items. That list said `conditional` for this same expense -- the two
-- disagreed, and the one that was wrong was the one with teeth. The
-- reference list is gone; `pub_502_rules` is now the single source of truth,
-- which is why this correction matters more than it did last week.

UPDATE public.pub_502_rules
SET
  eligibility_status = 'conditional',
  lmn_prompt =
    'To claim this, you need documentation from your doctor showing the '
    || 'procedure corrected a deformity from a congenital abnormality, a '
    || 'disfiguring disease, or an injury from an accident or trauma. '
    || 'Surgery to improve appearance alone does not qualify.',
  updated_at = now()
WHERE id = 'cosmetic-surgery';

-- Fail loudly if the row was not there: a silent no-op would leave the
-- classifier rejecting valid reconstructive claims with nothing to show for
-- this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pub_502_rules
    WHERE id = 'cosmetic-surgery' AND eligibility_status = 'conditional'
  ) THEN
    RAISE EXCEPTION
      'pub_502_rules row "cosmetic-surgery" missing or not updated';
  END IF;
END $$;
