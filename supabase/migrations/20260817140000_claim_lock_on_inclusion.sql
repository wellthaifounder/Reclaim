-- Workstream E2 — the claim lock, on inclusion.
--
-- From the spec: "Marking an expense reimbursed is necessary but fires too
-- late -- two requests generated days apart, before either deposit lands, can
-- legitimately contain the same expense. The lock must happen ON INCLUSION in
-- a request, not on arrival of money. Enforced at the database level, not in
-- application code."
--
-- Measured before writing this, three ways a claim could be doubled:
--
--   1. The same $3,200 surgery in two open records -> $6,400 claimed against
--      $3,200 of spending.
--   2. An expense paid with the HSA debit card entering a record at all. The
--      money already left the HSA; claiming it takes the same money twice.
--      The spec calls this "the single most important guard against
--      double-counting".
--   3. A fully reimbursed expense re-entering a record, with nothing left to
--      claim. Reproduced at three claims against one expense.
--
-- Today the only thing standing in the way is the picker's own query filter.
-- That is not a lock. It cannot see a second browser tab, a double-submit, or
-- a retry, and it is one refactor away from being dropped by accident.
--
-- WHY A DENORMALISED COLUMN. The constraint we want is "at most one
-- non-voided record per expense", and the status lives on the parent record. A
-- partial unique index cannot reference another table, so the parent's status
-- is mirrored onto the item and maintained by trigger. A BEFORE INSERT check
-- that counted sibling rows would not do: two concurrent transactions each see
-- zero and both insert. A unique index is the only thing here that actually
-- holds under concurrency.

-- ── 1. Mirror the record's status onto its items ───────────────────────────

ALTER TABLE public.substantiation_record_items
  ADD COLUMN IF NOT EXISTS record_status TEXT;

UPDATE public.substantiation_record_items sri
   SET record_status = sr.status
  FROM public.substantiation_records sr
 WHERE sr.id = sri.substantiation_record_id
   AND sri.record_status IS DISTINCT FROM sr.status;

ALTER TABLE public.substantiation_record_items
  ALTER COLUMN record_status SET DEFAULT 'generated';
ALTER TABLE public.substantiation_record_items
  ALTER COLUMN record_status SET NOT NULL;

ALTER TABLE public.substantiation_record_items
  DROP CONSTRAINT IF EXISTS substantiation_record_items_record_status_check;
ALTER TABLE public.substantiation_record_items
  ADD CONSTRAINT substantiation_record_items_record_status_check
  CHECK (record_status IN ('generated', 'reimbursed', 'voided'));

COMMENT ON COLUMN public.substantiation_record_items.record_status IS
  'Workstream E2: DERIVED mirror of substantiation_records.status, maintained by
   trg_records_propagate_status. It exists solely so the claim lock can be a
   partial unique index, which a cross-table check could never be. Do not write
   it directly -- set the parent record status instead.';

-- ── 2. Resolve the double claims already in the data ──────────────────────
-- The unique index cannot be created over violating rows, and E1 has just
-- imported legacy requests that may share an expense -- the old flow's own
-- double-claim bug, arriving as data.
--
-- The record that keeps the expense is the one that most represents reality:
-- a reimbursed record first (the money actually moved), then the earliest.
-- The losing items are removed and their records' totals recomputed, because a
-- record whose stated total no longer matches its contents is worse than one
-- with fewer expenses. What happened is written into the record's notes rather
-- than left for someone to discover by arithmetic.
--
-- Deliberately NOT voiding the losing records wholesale: they usually contain
-- other, legitimately claimed expenses, and voiding would release those too.

DO $$
DECLARE
  v_loser RECORD;
  v_total NUMERIC;
  v_count INTEGER;
BEGIN
  CREATE TEMP TABLE _claim_losers ON COMMIT DROP AS
  WITH ranked AS (
    SELECT sri.id AS item_id,
           sri.substantiation_record_id AS record_id,
           sri.invoice_id,
           sri.vendor_at_submission,
           sri.amount_at_submission,
           ROW_NUMBER() OVER w AS rank,
           -- Name the record that kept it. "An earlier claim" would be a lie
           -- half the time: a reimbursed record wins even when it was
           -- generated later, and a note about someone's money has to say
           -- what actually happened.
           FIRST_VALUE(sr.record_number) OVER w AS winner_number
      FROM substantiation_record_items sri
      JOIN substantiation_records sr ON sr.id = sri.substantiation_record_id
     WHERE sri.record_status <> 'voided'
    WINDOW w AS (
      PARTITION BY sri.invoice_id
      ORDER BY (sr.status = 'reimbursed') DESC,
               sr.generated_at ASC,
               sr.id ASC
    )
  )
  SELECT * FROM ranked WHERE rank > 1;

  FOR v_loser IN SELECT * FROM _claim_losers LOOP
    DELETE FROM substantiation_record_items WHERE id = v_loser.item_id;

    SELECT COALESCE(SUM(amount_at_submission), 0), COUNT(*)
      INTO v_total, v_count
      FROM substantiation_record_items
     WHERE substantiation_record_id = v_loser.record_id;

    UPDATE substantiation_records
       SET total_amount  = v_total,
           expense_count = v_count,
           -- An empty claim is not a claim. Voiding it keeps it in history,
           -- which is what the spec asks for, rather than deleting it.
           status = CASE WHEN v_count = 0 THEN 'voided' ELSE status END,
           notes = COALESCE(notes || E'\n', '')
                   || 'Reclaim: "' || v_loser.vendor_at_submission
                   || '" ($'  || TO_CHAR(v_loser.amount_at_submission, 'FM999999990.00')
                   || ') was removed from this claim because it is claimed in '
                   || v_loser.winner_number
                   || '. An expense can only be reimbursed once.',
           updated_at = now()
     WHERE id = v_loser.record_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM _claim_losers) THEN
    RAISE NOTICE 'E2: resolved % pre-existing double-claimed expense(s)',
      (SELECT COUNT(*) FROM _claim_losers);
  END IF;

  DROP TABLE IF EXISTS _claim_losers;
END $$;

-- ── 3. The lock ───────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_record_items_one_live_claim;
CREATE UNIQUE INDEX idx_record_items_one_live_claim
  ON public.substantiation_record_items (invoice_id)
  WHERE record_status <> 'voided';

COMMENT ON INDEX public.idx_record_items_one_live_claim IS
  'Workstream E2: the claim lock. An expense may sit in at most one non-voided
   record. Declarative because it has to survive concurrency -- two tabs
   submitting at once is the exact case a counted check misses. Voiding a
   record releases its expenses through the propagated record_status.';

-- ── 4. Keep the mirror true ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.propagate_record_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE substantiation_record_items
     SET record_status = NEW.status
   WHERE substantiation_record_id = NEW.id
     AND record_status <> NEW.status;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.propagate_record_status() IS
  'Workstream E2: voiding a record must release its expenses, and it does so by
   moving the mirrored status the claim lock reads. This is the mechanism E5''s
   one-action void relies on.';

DROP TRIGGER IF EXISTS trg_records_propagate_status ON public.substantiation_records;
CREATE TRIGGER trg_records_propagate_status
  AFTER UPDATE OF status ON public.substantiation_records
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.propagate_record_status();

-- ── 5. What is left to claim ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_remaining_amount(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT GREATEST(
           COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
           - COALESCE(i.reimbursed_amount, 0),
           0
         )
    FROM invoices i
   WHERE i.id = p_invoice_id
     AND i.user_id = auth.uid();
$fn$;

COMMENT ON FUNCTION public.expense_remaining_amount(UUID) IS
  'Workstream E2: reimbursable minus reimbursed -- what a new claim may still
   ask for. The spec''s selectability rule is eligible AND unclaimed AND
   remaining > 0.';

GRANT EXECUTE ON FUNCTION public.expense_remaining_amount(UUID) TO authenticated;

-- ── 6. The guards a unique index cannot express ───────────────────────────
-- The index stops the same expense being in two live records. It cannot know
-- that HSA-card spend must never be claimed, or that a fully reimbursed
-- expense has nothing left to ask for. Those are single-row facts, so a
-- BEFORE INSERT check is sufficient for them -- and the two concurrent inserts
-- that a trigger alone would miss are caught by the index above.

CREATE OR REPLACE FUNCTION public.guard_record_item_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec       RECORD;
  v_inv       RECORD;
  v_remaining NUMERIC;
BEGIN
  SELECT sr.user_id, sr.status, sr.record_number
    INTO v_rec
    FROM substantiation_records sr
   WHERE sr.id = NEW.substantiation_record_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'CLAIM_NO_RECORD: that reimbursement record does not exist';
  END IF;

  SELECT i.user_id, i.claim_state, i.vendor
    INTO v_inv
    FROM invoices i
   WHERE i.id = NEW.invoice_id;

  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'CLAIM_NO_EXPENSE: that expense does not exist';
  END IF;

  -- An expense and the record claiming it must belong to the same person.
  -- Row-level security governs each table separately and would not, by itself,
  -- stop one user's expense being written into another user's record.
  IF v_inv.user_id <> v_rec.user_id THEN
    RAISE EXCEPTION 'CLAIM_WRONG_OWNER: that expense belongs to someone else';
  END IF;

  -- The money already left the HSA when the card was swiped. Claiming it back
  -- would be taking the same money twice, and no later correction catches it.
  IF v_inv.claim_state = 'not_reimbursable' THEN
    RAISE EXCEPTION
      'CLAIM_HSA_CARD_PAID: % was paid with the HSA card, so it cannot be reimbursed again',
      v_inv.vendor;
  END IF;

  SELECT GREATEST(
           COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
           - COALESCE(i.reimbursed_amount, 0), 0)
    INTO v_remaining
    FROM invoices i WHERE i.id = NEW.invoice_id;

  IF v_remaining <= 0 THEN
    RAISE EXCEPTION
      'CLAIM_NOTHING_REMAINING: % has already been reimbursed in full',
      v_inv.vendor;
  END IF;

  -- record_status is derived. Taking it from the parent rather than from the
  -- caller means the lock cannot be sidestepped by inserting an item that
  -- claims to be voided.
  NEW.record_status := v_rec.status;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.guard_record_item_insert() IS
  'Workstream E2: the single-row half of the double-claim guard -- ownership,
   HSA-card spend, and nothing-left-to-claim. The concurrent half is
   idx_record_items_one_live_claim.';

DROP TRIGGER IF EXISTS trg_record_items_guard ON public.substantiation_record_items;
CREATE TRIGGER trg_record_items_guard
  BEFORE INSERT ON public.substantiation_record_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_record_item_insert();

-- ── 7. Claimable expenses, one definition ─────────────────────────────────
-- So the picker and the lock cannot drift apart: the screen asks the database
-- what is claimable rather than assembling its own filter.

DROP FUNCTION IF EXISTS public.claimable_expenses();
CREATE FUNCTION public.claimable_expenses()
RETURNS TABLE (
  invoice_id       UUID,
  vendor           TEXT,
  service_date     DATE,
  tax_year         INTEGER,
  category         TEXT,
  patient_name     TEXT,
  remaining_amount NUMERIC,
  confirmed_at     TIMESTAMPTZ,
  rule_id          TEXT,
  rule_name        TEXT,
  rule_section_ref TEXT,
  receipt_paths    TEXT[]
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
    GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
             - COALESCE(i.reimbursed_amount, 0), 0),
    i.confirmed_at,
    i.eligibility_basis_rule_id,
    pr.name,
    pr.section_ref,
    -- Paths, not a count: the record's PDF embeds the receipt images, and a
    -- second round trip for them would let the picker and the document set
    -- disagree about what is attached.
    COALESCE(
      (SELECT ARRAY_AGG(r.file_path ORDER BY r.uploaded_at)
         FROM receipts r WHERE r.invoice_id = i.id),
      ARRAY[]::TEXT[]
    )
  FROM invoices i
  LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
  WHERE i.user_id = auth.uid()
    AND i.eligibility_state = 'eligible'
    AND i.claim_state = 'unclaimed'
    AND GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                 - COALESCE(i.reimbursed_amount, 0), 0) > 0
    -- Belt and braces against the lock: an expense sitting in a live record is
    -- not offered even if its claim_state somehow says otherwise.
    AND NOT EXISTS (
      SELECT 1 FROM substantiation_record_items sri
       WHERE sri.invoice_id = i.id
         AND sri.record_status <> 'voided'
    )
  ORDER BY i.effective_service_date ASC;
$fn$;

COMMENT ON FUNCTION public.claimable_expenses() IS
  'Workstream E2: the spec''s selectability rule in one place -- eligible,
   unclaimed, remaining > 0, and not already inside a live claim. The picker
   reads this so the screen and the lock cannot disagree about what is
   claimable.';

GRANT EXECUTE ON FUNCTION public.claimable_expenses() TO authenticated;
