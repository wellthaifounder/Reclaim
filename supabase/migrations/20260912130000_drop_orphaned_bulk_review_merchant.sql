-- Drop the orphaned two-argument bulk_review_merchant.
--
-- THE BUG. 20260905130000 added the `possible_otc` lane and gave
-- bulk_review_merchant a third parameter, p_lane, via CREATE OR REPLACE.
-- CREATE OR REPLACE cannot change a function's parameter list -- it creates a
-- NEW function instead -- so the two-argument version from 20260815140000 was
-- never replaced. It has been sitting alongside the real one ever since, and
-- 20260906120000 then replaced only the three-argument one, leaving the orphan
-- further behind.
--
-- WHY IT MATTERS. Two overloads that differ only by a defaulted trailing
-- parameter make a two-argument call ambiguous. Reproduced 2026-09-12:
--
--   SQL:       ERROR: function bulk_review_merchant(unknown, boolean) is not
--              unique / Could not choose a best candidate function.
--   PostgREST: HTTP 300, PGRST203 -- "Could not choose the best candidate
--              function between: public.bulk_review_merchant(p_merchant_key
--              => text, p_is_medical => boolean), public.bulk_review_merchant(
--              p_merchant_key => text, p_is_medical => boolean, p_lane =>
--              text)"
--
-- useReviewFeed's decideGroup types `lane` as optional, and supabase-js omits
-- an undefined value from the JSON body -- so any caller that leaves the lane
-- off sends exactly the two-key payload that fails. Both of today's call sites
-- happen to pass a lane, which is the only reason this has not fired in
-- production. That is luck, not a design.
--
-- WHY DROPPING IS SAFE, AND IS THE WHOLE FIX. The orphan's body is the current
-- function's body minus the lane filter -- byte for byte what the survivor
-- already does when p_lane IS NULL. Nothing in the schema depends on it
-- (pg_depend returns no dependent objects). Once it is gone, a two-argument
-- call resolves unambiguously to the survivor with p_lane defaulting to NULL,
-- which restores exactly the old "every lane" behaviour. So this removes a
-- failure mode without removing a capability.
--
-- The three-argument function is deliberately NOT touched here: the live
-- frontend calls it by name throughout the window between this migration and
-- the next deploy.

DROP FUNCTION IF EXISTS public.bulk_review_merchant(TEXT, BOOLEAN);

COMMENT ON FUNCTION public.bulk_review_merchant(TEXT, BOOLEAN, TEXT) IS
  'Decides every still-unreviewed transaction for one merchant key. p_lane scopes the decision to one review lane (''medical'' or ''possible_otc''); NULL means every lane, which is what the retired two-argument overload used to do.';
