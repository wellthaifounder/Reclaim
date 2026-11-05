-- Launch plan L3 (Batch 2) -- "I got paid" closes a claim by hand.
--
-- Until now a SENT claim could close only one way: a deposit from a connected
-- bank, matched by match_reimbursement_deposits() and confirmed through
-- confirm_deposit_match(). Anyone without a bank connection had no way to say
-- "the custodian paid me", so their claims sat at "Awaiting deposit" for ever
-- and their expenses stayed locked inside them.
--
-- L3: the user states the amount that arrived, pre-filled with the claim total
-- and editable. Paid in full closes the claim exactly as a confirmed deposit
-- does. Paid short closes it too, and the shortfall goes back to "ready to
-- claim" so it can be claimed again.
--
-- WHY THE CLAIM LOCK HAS TO NARROW. The lock (idx_record_items_one_live_claim)
-- said "an expense may sit in at most one SENT or REIMBURSED claim", and
-- claimable (substantiatable_expenses) said "not inside a sent or reimbursed
-- claim". Both were written when a reimbursed claim meant the expense was paid
-- in full -- confirm_deposit_match absorbs any gap -- so "reimbursed" was a
-- safe proxy for "nothing left". A short payment breaks that: the claim is
-- closed (reimbursed) but its expense still has money owed on it. Left as is,
-- that remainder could never be claimed: claimable would hide it, and any new
-- claim holding it would hit the unique index when sent.
--
-- So the lock now keys off SENT only -- "at most one claim waiting on the
-- custodian at a time" -- and the protection the 'reimbursed' half used to give
-- moves to where the facts actually live, on the expense:
--
--   * a fully paid expense has claim_state='reimbursed', so it is not claimable
--     and guard_record_item_insert refuses it (nothing remaining);
--   * mark_record_sent now refuses a draft whose expense is no longer
--     unclaimed, or whose draft amount is more than is still owed. That second
--     check is what stops a draft built BEFORE a short payment from asking the
--     custodian for the already-paid part a second time.
--
-- Everything runs inside one function call, so one transaction, like
-- confirm_deposit_match.

-- ── 1. What a hand-closed claim records ──────────────────────────────────

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(12,2);

COMMENT ON COLUMN public.substantiation_records.amount_received IS
  'L3: what the user said their custodian actually paid on this claim, when
   they closed it by hand (close_claim_by_hand). NULL for a claim closed by a
   matched deposit, or not closed. Less than total_amount means paid short --
   the difference went back to the expenses as claimable.';

-- ── 2. The claim lock keys off SENT only ─────────────────────────────────
-- Narrowing a partial unique index can only remove rows from it, so this
-- cannot fail on existing data.

DROP INDEX IF EXISTS public.idx_record_items_one_live_claim;
CREATE UNIQUE INDEX idx_record_items_one_live_claim
  ON public.substantiation_record_items (invoice_id)
  WHERE record_status = 'sent' AND record_purpose = 'claim';

COMMENT ON INDEX public.idx_record_items_one_live_claim IS
  'Spec D30-D31, narrowed by L3: an expense may sit in at most one SENT claim
   at a time. A reimbursed claim no longer holds it here -- a claim paid short
   returns the remainder to claimable (close_claim_by_hand), and a fully paid
   expense is kept out by claim_state=''reimbursed'' and by the checks in
   guard_record_item_insert and mark_record_sent.';

-- ── 3. Claimable agrees with the lock ────────────────────────────────────
-- The live definition (20260930120000) with one change: "already claimed"
-- means inside a SENT claim. claim_state='unclaimed' and remaining > 0 still
-- keep every fully paid expense out.

CREATE OR REPLACE FUNCTION public.substantiatable_expenses()
RETURNS TABLE(
  invoice_id          UUID,
  vendor              TEXT,
  service_date        DATE,
  tax_year            INTEGER,
  category            TEXT,
  patient_name        TEXT,
  full_amount         NUMERIC,
  remaining_amount    NUMERIC,
  claim_state         TEXT,
  claimable           BOOLEAN,
  confirmed_at        TIMESTAMPTZ,
  rule_id             TEXT,
  rule_name           TEXT,
  rule_section_ref    TEXT,
  documentation_state TEXT,
  documents           JSONB,
  rule_status         TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    i.id,
    i.vendor,
    i.effective_service_date,
    EXTRACT(YEAR FROM i.effective_service_date)::INT,
    i.category,
    i.patient_name,
    COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
    GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
             - COALESCE(i.reimbursed_amount, 0), 0),
    i.claim_state::TEXT,
    -- Spec D30-D31: a draft (record_status='generated') does not count as
    -- "already claimed". L3: nor does a reimbursed claim -- one paid short
    -- leaves a remainder that must be claimable again, and one paid in full
    -- has already moved claim_state off 'unclaimed'.
    (
      i.claim_state = 'unclaimed'
      AND GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                   - COALESCE(i.reimbursed_amount, 0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM substantiation_record_items sri
         WHERE sri.invoice_id = i.id
           AND sri.record_status = 'sent'
           AND sri.record_purpose = 'claim'
      )
    ),
    i.confirmed_at,
    i.eligibility_basis_rule_id,
    pr.name,
    pr.section_ref,
    i.documentation_state,
    COALESCE(
      (SELECT JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'path', r.file_path,
                  'type', r.document_type,
                  'description', r.description)
                ORDER BY r.uploaded_at)
         FROM receipts r
         JOIN receipt_invoices ri ON ri.receipt_id = r.id
        WHERE ri.invoice_id = i.id),
      '[]'::JSONB
    ),
    pr.eligibility_status
  FROM invoices i
  LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
  WHERE i.user_id = auth.uid()
    AND i.eligibility_state = 'eligible'
    AND i.claim_state <> 'reimbursed_externally'
  ORDER BY i.effective_service_date ASC, i.vendor ASC;
$fn$;

-- ── 4. Sending checks what the lock no longer can ────────────────────────
-- The live definition (20260916120000) plus one block: before locking
-- anything, every expense in the draft must still be unclaimed and still owe
-- at least what the draft asks for. Previously a draft holding an expense that
-- had since been reimbursed was refused by the unique index; with the index
-- narrowed to 'sent', this check is what refuses it. It also refuses cases the
-- index never caught -- a draft asking for more than is now owed.

CREATE OR REPLACE FUNCTION public.mark_record_sent(p_record_id UUID)
RETURNS TABLE (
  record_number   TEXT,
  expenses_locked INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_rec   RECORD;
  v_stale RECORD;
  v_now   TIMESTAMPTZ := now();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT sr.id, sr.status, sr.purpose, sr.record_number
    INTO v_rec
    FROM substantiation_records sr
   WHERE sr.id = p_record_id
     AND sr.user_id = v_user
     -- Two tabs sending (or one sending while another closes) take turns.
     FOR UPDATE;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'SEND_NOT_FOUND: that record does not exist';
  END IF;

  IF v_rec.purpose <> 'claim' THEN
    RAISE EXCEPTION
      'SEND_NOT_A_CLAIM: % is kept as evidence, not sent to a custodian',
      v_rec.record_number;
  END IF;

  -- Marking sent twice is the same as marking it once -- a double-click or a
  -- retry after a dropped connection must not raise an error at the user.
  IF v_rec.status = 'sent' THEN
    RETURN QUERY SELECT v_rec.record_number, 0;
    RETURN;
  END IF;

  IF v_rec.status <> 'generated' THEN
    RAISE EXCEPTION
      'SEND_WRONG_STATUS: % is % and cannot be marked sent from there',
      v_rec.record_number, v_rec.status;
  END IF;

  -- L3. Lock the expenses first, so a claim being closed by hand (or a deposit
  -- being confirmed) on the same expenses in another tab finishes before this
  -- reads them, and this reads what it left behind.
  PERFORM 1
     FROM invoices i
     JOIN substantiation_record_items sri ON sri.invoice_id = i.id
    WHERE sri.substantiation_record_id = p_record_id
      AND i.user_id = v_user
      FOR UPDATE OF i;

  -- A claim generated before 2026-09-16 (lock-on-generate) and never sent is
  -- still a draft whose expenses are already locked_in_request with this
  -- draft as their back-link. That lock is this draft's own, not a sign the
  -- expense moved on, so it is exempt -- the amount condition still applies.
  SELECT i.id
    INTO v_stale
    FROM substantiation_record_items sri
    JOIN invoices i ON i.id = sri.invoice_id
   WHERE sri.substantiation_record_id = p_record_id
     AND ((i.claim_state <> 'unclaimed'
           AND NOT (i.claim_state = 'locked_in_request'
                    AND i.submitted_record_id = p_record_id))
          OR sri.amount_at_submission
             > GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                        - COALESCE(i.reimbursed_amount, 0), 0) + 0.005)
   LIMIT 1;

  -- No provider or health detail in the message: errors travel to logs.
  IF FOUND THEN
    RAISE EXCEPTION
      'SEND_STALE_DRAFT: something in % changed since this draft was built',
      v_rec.record_number;
  END IF;

  WITH locked AS (
    UPDATE invoices i
       SET claim_state          = 'locked_in_request',
           submitted_at         = COALESCE(i.submitted_at, v_now),
           -- First record to lock an invoice owns the back-link, same rule
           -- the browser used to apply at generation time.
           submitted_record_id  = COALESCE(i.submitted_record_id, p_record_id),
           updated_at           = v_now
      FROM substantiation_record_items sri
     WHERE sri.substantiation_record_id = p_record_id
       AND sri.invoice_id = i.id
       AND i.user_id = v_user
       AND i.claim_state = 'unclaimed'
    RETURNING i.id
  )
  SELECT COUNT(*)::INTEGER INTO expenses_locked FROM locked;

  -- Fires trg_records_propagate_status, which mirrors 'sent' onto the items --
  -- and THAT is what the claim lock actually reads. A sibling draft already
  -- holding one of these invoice_ids as sent makes this a unique violation,
  -- which rolls back the invoice lock above along with it.
  UPDATE substantiation_records
     SET status     = 'sent',
         sent_at    = v_now,
         updated_at = v_now
   WHERE id = p_record_id
     AND user_id = v_user;

  record_number := v_rec.record_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mark_record_sent(UUID) IS
  'Spec D31: the real commitment. Locks every expense in this claim and moves
   it from draft (generated) to sent. L3: refuses a draft whose expenses are no
   longer unclaimed or now owe less than the draft asks for.';

GRANT EXECUTE ON FUNCTION public.mark_record_sent(UUID) TO authenticated;

-- ── 5. "I got paid" ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_claim_by_hand(
  p_record_id       UUID,
  p_amount_received NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  record_number     TEXT,
  claim_total       NUMERIC,
  received          NUMERIC,
  shortfall         NUMERIC,
  expenses_paid     INTEGER,
  expenses_reopened INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_now    TIMESTAMPTZ := now();
  v_rec    RECORD;
  v_total  NUMERIC;
  v_items  INTEGER;
  v_amount NUMERIC;
  v_short  NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Ownership is part of the lookup: another user's claim is simply not
  -- found, which says nothing about whether it exists. FOR UPDATE so two tabs
  -- closing the same claim take turns, and the second sees it already closed.
  SELECT sr.id, sr.status, sr.purpose, sr.record_number
    INTO v_rec
    FROM substantiation_records sr
   WHERE sr.id = p_record_id
     AND sr.user_id = v_user
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLOSE_NOT_FOUND: that claim does not exist';
  END IF;

  IF v_rec.purpose <> 'claim' THEN
    RAISE EXCEPTION
      'CLOSE_NOT_A_CLAIM: % is kept as evidence, nothing was claimed',
      v_rec.record_number;
  END IF;

  -- Only a claim the custodian actually has can have been paid. A draft was
  -- never filed; a reimbursed claim is already closed; a withdrawn one was
  -- taken back. Refusing a second close is deliberate: it would add the money
  -- to the expenses twice.
  IF v_rec.status <> 'sent' THEN
    RAISE EXCEPTION
      'CLOSE_WRONG_STATUS: % is % and cannot be closed as paid',
      v_rec.record_number, v_rec.status;
  END IF;

  -- The claim total is what the custodian was asked for: the snapshot
  -- amounts, which is also what confirm_deposit_match applies.
  SELECT COALESCE(SUM(sri.amount_at_submission), 0), COUNT(*)
    INTO v_total, v_items
    FROM substantiation_record_items sri
   WHERE sri.substantiation_record_id = p_record_id;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'CLOSE_EMPTY: % has no expenses in it', v_rec.record_number;
  END IF;

  -- L3: pre-filled with the claim total, so no amount means paid in full.
  v_amount := ROUND(COALESCE(p_amount_received, v_total), 2);

  -- Nothing received is a rejected claim, which is a withdrawal -- every
  -- expense goes back to claimable -- not a payment.
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION
      'CLOSE_BAD_AMOUNT: the amount received must be more than zero';
  END IF;

  -- More than was claimed cannot be applied to these expenses: each is capped
  -- at what it could ever ask for, so the excess would vanish silently.
  -- (NaN compares greater than every number, so it is refused here too.)
  IF v_amount > v_total THEN
    RAISE EXCEPTION
      'CLOSE_TOO_MUCH: % is more than the % claimed on %',
      v_amount, v_total, v_rec.record_number;
  END IF;

  v_short := v_total - v_amount;

  -- Lock the expenses before reading their money, same reason as above.
  PERFORM 1
     FROM invoices i
     JOIN substantiation_record_items sri ON sri.invoice_id = i.id
    WHERE sri.substantiation_record_id = p_record_id
      AND i.user_id = v_user
      FOR UPDATE OF i;

  -- What arrived, per expense. Paid in full: each expense gets its own
  -- claimed amount, exactly as confirm_deposit_match applies it.
  --
  -- Paid short -- L3, founder 2026-11-04: OLDEST FIRST. The money that arrived
  -- pays the oldest expenses in full first, ordered by date of care, then
  -- created_at, then id (so the order is total and repeatable). The shortfall
  -- lands on the newest expense or expenses, and each one left owing goes
  -- back to "ready to claim" with its remainder.
  WITH ordered AS (
    SELECT sri.invoice_id,
           sri.amount_at_submission AS claimed,
           SUM(sri.amount_at_submission) OVER (
             ORDER BY i.effective_service_date ASC NULLS LAST,
                      i.created_at ASC, i.id ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS running
      FROM substantiation_record_items sri
      JOIN invoices i ON i.id = sri.invoice_id
     WHERE sri.substantiation_record_id = p_record_id
       AND i.user_id = v_user
  ),
  alloc AS (
    SELECT o.invoice_id,
           o.claimed,
           -- What is left of the received money once every older expense has
           -- been paid, capped at this expense's claim and floored at zero.
           CASE WHEN v_short = 0 THEN o.claimed
                ELSE LEAST(o.claimed,
                           GREATEST(v_amount - (o.running - o.claimed), 0))
           END AS applied
      FROM ordered o
  ),
  money AS (
    SELECT i.id,
           a.claimed,
           a.applied,
           COALESCE(i.reimbursable_amount, i.amount_paid, i.amount) AS ceiling,
           -- Capped at what the expense could ever ask for and accumulated
           -- rather than assigned -- confirm_deposit_match's rule, so a second
           -- payment against a partly paid expense cannot exceed it.
           LEAST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
                 COALESCE(i.reimbursed_amount, 0) + a.applied) AS new_reimbursed
      FROM invoices i
      JOIN alloc a ON a.invoice_id = i.id
     WHERE i.user_id = v_user
  ),
  applied AS (
    UPDATE invoices i
       SET reimbursed_amount = m.new_reimbursed,
           -- Paid what was claimed: closed, the same as a confirmed deposit
           -- (which also absorbs rounding dust left on the expense). Paid
           -- less: whatever is still owed goes back to "ready to claim".
           claim_state = CASE
             WHEN m.applied >= m.claimed OR m.new_reimbursed >= m.ceiling
               THEN 'reimbursed'::expense_claim_state
             ELSE 'unclaimed'::expense_claim_state
           END,
           -- The back-link described a claim the expense is no longer
           -- waiting on -- the same reason void_substantiation_record clears
           -- it. Kept when the expense is closed: that claim paid it.
           submitted_record_id = CASE
             WHEN m.applied >= m.claimed OR m.new_reimbursed >= m.ceiling
               THEN i.submitted_record_id
             ELSE NULL
           END,
           submitted_at = CASE
             WHEN m.applied >= m.claimed OR m.new_reimbursed >= m.ceiling
               THEN i.submitted_at
             ELSE NULL
           END,
           -- When money last arrived, partial or not. An expense this payment
           -- did not reach at all keeps whatever it had.
           reimbursed_at = CASE WHEN m.applied > 0 THEN v_now
                                ELSE i.reimbursed_at END,
           updated_at    = v_now
      FROM money m
     WHERE i.id = m.id
       AND i.user_id = v_user
    RETURNING i.claim_state
  )
  SELECT COUNT(*) FILTER (WHERE a.claim_state = 'reimbursed')::INTEGER,
         COUNT(*) FILTER (WHERE a.claim_state = 'unclaimed')::INTEGER
    INTO expenses_paid, expenses_reopened
    FROM applied a;

  -- Fires trg_records_propagate_status, which mirrors 'reimbursed' onto the
  -- items. With the lock narrowed to 'sent' above, that releases a reopened
  -- expense for a new claim; a fully paid one stays out through claim_state.
  UPDATE substantiation_records
     SET status          = 'reimbursed',
         reimbursed_at   = v_now,
         amount_received = v_amount,
         updated_at      = v_now
   WHERE id = p_record_id
     AND user_id = v_user;

  -- A deposit prompt still pending against this claim is now answered. So is
  -- any batch reading it belongs to: a batch is one claim about one deposit,
  -- and rejecting it rejects the whole reading (dismiss_deposit_match's rule)
  -- -- otherwise its other members would go on offering a deposit whose sum
  -- no longer adds up.
  UPDATE reimbursement_match_candidates c
     SET status = 'dismissed', resolved_at = v_now
   WHERE c.user_id = v_user
     AND c.status = 'pending'
     AND (c.substantiation_record_id = p_record_id
          OR c.match_group_id IN (
               SELECT g.match_group_id
                 FROM reimbursement_match_candidates g
                WHERE g.user_id = v_user
                  AND g.substantiation_record_id = p_record_id
                  AND g.status = 'pending'
                  AND g.match_group_id IS NOT NULL));

  record_number := v_rec.record_number;
  claim_total   := v_total;
  received      := v_amount;
  shortfall     := v_short;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.close_claim_by_hand(UUID, NUMERIC) IS
  'L3: "I got paid". Closes a SENT claim owned by the caller in one
   transaction. No amount, or the claim total, applies the money the same way
   confirm_deposit_match does. Less than the total pays the oldest expenses
   first (founder 2026-11-04) and returns the shortfall on the newest to
   claimable. Refuses zero, negative, more than the total, and any claim not
   sent.';

REVOKE ALL ON FUNCTION public.close_claim_by_hand(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_claim_by_hand(UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_claim_by_hand(UUID, NUMERIC)
  TO authenticated;

-- ── 6. Confirming a deposit cannot pay a claim twice ─────────────────────
-- The live definition (20260817180000, not redefined since) with one block
-- added: every claim the deposit would close is locked and must still be
-- SENT. Now that a claim can also be closed by hand, a confirm racing a hand
-- close on the same claim would otherwise add the money to its expenses a
-- second time. The gap-absorbing rule is unchanged.

CREATE OR REPLACE FUNCTION public.confirm_deposit_match(p_candidate_id UUID)
RETURNS TABLE (
  record_id        UUID,
  record_number    TEXT,
  expenses_closed  INTEGER,
  amount_applied   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_now    TIMESTAMPTZ := now();
  v_cand   RECORD;
  v_member RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.id, c.transaction_id, c.match_group_id, c.status
    INTO v_cand
    FROM reimbursement_match_candidates c
   WHERE c.id = p_candidate_id
     AND c.user_id = v_user;

  IF v_cand IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND: that deposit match no longer exists';
  END IF;
  IF v_cand.status <> 'pending' THEN
    RAISE EXCEPTION 'MATCH_RESOLVED: that deposit match was already %',
      v_cand.status;
  END IF;

  -- L3. Lock every claim this confirmation would close, in a fixed order so
  -- two confirmations cannot deadlock, then refuse if any is no longer sent
  -- (closed by hand, or withdrawn, a moment ago). One refusal refuses the
  -- whole batch: its amounts only add up together.
  PERFORM 1
     FROM substantiation_records sr
    WHERE sr.user_id = v_user
      AND sr.id IN (
            SELECT c.substantiation_record_id
              FROM reimbursement_match_candidates c
             WHERE c.user_id = v_user
               AND c.status = 'pending'
               AND (c.id = p_candidate_id
                    OR (v_cand.match_group_id IS NOT NULL
                        AND c.match_group_id = v_cand.match_group_id)))
    ORDER BY sr.id
      FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM substantiation_records sr
      JOIN reimbursement_match_candidates c
        ON c.substantiation_record_id = sr.id
     WHERE c.user_id = v_user
       AND (c.id = p_candidate_id
            OR (v_cand.match_group_id IS NOT NULL
                AND c.match_group_id = v_cand.match_group_id))
       AND sr.status <> 'sent'
  ) THEN
    RAISE EXCEPTION 'MATCH_RECORD_CLOSED: a claim this deposit would pay is no longer waiting for payment';
  END IF;

  -- A batched deposit is only true as a set: the amounts add up to the deposit
  -- together and to nothing apart. Confirming one member confirms the group.
  FOR v_member IN
    SELECT c.id, c.substantiation_record_id AS rec_id
      FROM reimbursement_match_candidates c
     WHERE c.user_id = v_user
       AND c.status = 'pending'
       AND (c.id = p_candidate_id
            OR (v_cand.match_group_id IS NOT NULL
                AND c.match_group_id = v_cand.match_group_id))
  LOOP
    UPDATE reimbursement_match_candidates
       SET status = 'confirmed', resolved_at = v_now
     WHERE id = v_member.id;

    -- The money lands in the ledger, not just in a status. Capped at what the
    -- expense could ever ask for, and accumulated rather than assigned, so a
    -- second reimbursement against a partly paid expense cannot exceed it.
    --
    -- A rounding shortfall is absorbed here rather than left behind: the user
    -- has just said this deposit closed the claim, and leaving $1.40 of
    -- "remaining" on an expense would put unclaimable dust back into the
    -- claimable set for ever.
    WITH closed AS (
      UPDATE invoices i
         SET reimbursed_amount = LEAST(
               COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
               COALESCE(i.reimbursed_amount, 0) + sri.amount_at_submission),
             claim_state   = 'reimbursed',
             reimbursed_at = v_now,
             updated_at    = v_now
        FROM substantiation_record_items sri
       WHERE sri.substantiation_record_id = v_member.rec_id
         AND sri.invoice_id = i.id
         AND i.user_id = v_user
      RETURNING sri.amount_at_submission AS applied
    )
    SELECT v_member.rec_id,
           (SELECT sr.record_number FROM substantiation_records sr
             WHERE sr.id = v_member.rec_id),
           COUNT(*)::INTEGER,
           COALESCE(SUM(applied), 0)
      INTO record_id, record_number, expenses_closed, amount_applied
      FROM closed;

    -- Setting the status fires trg_records_propagate_status, which moves the
    -- mirrored record_status the claim lock reads. 'reimbursed' is still not
    -- 'voided', so the expenses stay locked -- correct: a reimbursed expense
    -- must never become claimable again.
    UPDATE substantiation_records
       SET status                    = 'reimbursed',
           reimbursed_at             = v_now,
           reimbursed_transaction_id = v_cand.transaction_id,
           updated_at                = v_now
     WHERE id = v_member.rec_id
       AND user_id = v_user;

    -- Nothing else can still be pending against a record that is now closed,
    -- nor against a deposit that has now been spent.
    UPDATE reimbursement_match_candidates
       SET status = 'dismissed', resolved_at = v_now
     WHERE user_id = v_user
       AND status = 'pending'
       AND (substantiation_record_id = v_member.rec_id
            OR transaction_id = v_cand.transaction_id);

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.confirm_deposit_match(UUID) IS
  'Workstream E4: one atomic close-out. Applies reimbursed_amount, moves every
   member expense to claim_state=''reimbursed'', closes the record, and clears
   competing candidates. Confirms the whole group for a batched deposit. L3:
   refuses if any claim it would close is no longer sent.';

GRANT EXECUTE ON FUNCTION public.confirm_deposit_match(UUID) TO authenticated;

-- ── 7. Comment kept true ─────────────────────────────────────────────────

COMMENT ON FUNCTION public.claimable_expenses() IS
  'Spec D30-D31, L3: eligible, unclaimed, remaining > 0, and not already inside
   a SENT claim. A draft claim over an expense does not remove it from this
   list, and nor does a claim paid short -- its remainder is claimable again.
   Thin filter over substantiatable_expenses(), which is the one place the
   predicate lives.';
