-- Workstream E5 — voiding a claim.
--
-- From the spec: "A custodian rejection voids the request in one action,
-- returning every expense to claimable. The voided request stays in history
-- rather than being deleted."
--
-- E2 built half of this and said so: propagate_record_status moves the
-- mirrored record_status the claim lock reads, so voiding already releases the
-- unique index. That is necessary and not sufficient. The selectability rule
-- has three parts -- eligible AND unclaimed AND remaining > 0 -- and generating
-- a record sets every member expense to claim_state='locked_in_request'.
-- Nothing ever set it back.
--
-- So voiding today releases the lock onto expenses that claimable_expenses()
-- will never return: not in a live claim, not claimable either, and with no
-- screen anywhere that shows them. The money would simply disappear from the
-- product. This migration is what makes "returns every expense to claimable"
-- actually true.
--
-- WHY A REIMBURSED RECORD CANNOT BE VOIDED. Voiding returns expenses to
-- claimable, and an expense whose money already arrived must never become
-- claimable again -- that is the double-claim the whole workstream exists to
-- prevent. Undoing a wrongly confirmed deposit is a different action against a
-- different fact (the money), and it is not this one.

-- ── 1. What a void records ────────────────────────────────────────────────

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

COMMENT ON COLUMN public.substantiation_records.voided_at IS
  'Workstream E5: when the claim was withdrawn. Distinct from updated_at, which
   moves for any edit -- a user looking at their history needs to know when this
   claim stopped being live, not when the row was last touched.';
COMMENT ON COLUMN public.substantiation_records.void_reason IS
  'Workstream E5: why, in the user''s own words where they gave one. A custodian
   rejection months later is only intelligible if the reason travels with the
   record; "voided" on its own tells a future reader nothing.';

-- ── 2. The one action ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_substantiation_record(
  p_record_id UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE (
  record_number     TEXT,
  expenses_released INTEGER,
  amount_released   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_rec  RECORD;
  v_now  TIMESTAMPTZ := now();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT sr.id, sr.status, sr.record_number
    INTO v_rec
    FROM substantiation_records sr
   WHERE sr.id = p_record_id
     AND sr.user_id = v_user;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'VOID_NOT_FOUND: that claim does not exist';
  END IF;

  IF v_rec.status = 'reimbursed' THEN
    RAISE EXCEPTION 'VOID_REIMBURSED: % has already been paid, so its expenses '
                    'cannot go back into the claimable pool', v_rec.record_number;
  END IF;

  -- Voiding twice is the same as voiding once. A double-click, a retry after a
  -- dropped connection, or two open tabs must not raise an error at the user.
  IF v_rec.status = 'voided' THEN
    RETURN QUERY SELECT v_rec.record_number, 0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Return the expenses. Only those still locked INTO THIS RECORD are touched:
  -- 'not_reimbursable' (HSA-card spend) and anything already reimbursed keep
  -- the state they have, because neither was made claimable by this claim and
  -- neither becomes claimable by withdrawing it.
  WITH released AS (
    UPDATE invoices i
       SET claim_state = 'unclaimed',
           -- The back-link and its timestamp described a live claim. Leaving
           -- them would have the expense still pointing at a claim that was
           -- withdrawn, which is how a screen ends up saying "submitted" about
           -- something that is sitting in the claimable list.
           submitted_record_id = NULL,
           submitted_at        = NULL,
           updated_at          = v_now
      FROM substantiation_record_items sri
     WHERE sri.substantiation_record_id = p_record_id
       AND sri.invoice_id = i.id
       AND i.user_id = v_user
       AND i.claim_state = 'locked_in_request'
    RETURNING i.id,
              GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                       - COALESCE(i.reimbursed_amount, 0), 0) AS remaining
  )
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(remaining), 0)
    INTO expenses_released, amount_released
    FROM released;

  -- Fires trg_records_propagate_status, which mirrors 'voided' onto the items
  -- and so releases the claim lock's partial unique index. The items THEMSELVES
  -- stay: they are the snapshot of what was claimed, and the spec asks for the
  -- record to be preserved in history, not gutted.
  UPDATE substantiation_records
     SET status      = 'voided',
         voided_at   = v_now,
         void_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
         updated_at  = v_now
   WHERE id = p_record_id
     AND user_id = v_user;

  -- A withdrawn claim must stop attracting deposits. E4's scan only looks at
  -- records with status 'generated', so no NEW candidate can appear -- but one
  -- already pending would go on asking "did this deposit close RCM-0003?"
  -- about a claim the user has just withdrawn.
  UPDATE reimbursement_match_candidates
     SET status = 'dismissed', resolved_at = v_now
   WHERE user_id = v_user
     AND substantiation_record_id = p_record_id
     AND status = 'pending';

  record_number := v_rec.record_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.void_substantiation_record(UUID, TEXT) IS
  'Workstream E5: withdraw a claim in one action. Returns its expenses to
   claimable, releases the claim lock, dismisses any deposit prompts still
   pending against it, and keeps the record and its snapshot in history.
   Refuses a reimbursed record: money that arrived cannot be re-claimed.';

GRANT EXECUTE ON FUNCTION public.void_substantiation_record(UUID, TEXT)
  TO authenticated;
