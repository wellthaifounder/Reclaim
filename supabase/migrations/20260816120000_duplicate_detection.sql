-- Workstream C6 — duplicate detection.
--
-- From the workflow spec, Step 3 (Double-claim prevention): "Duplicate expense
-- records are the sneakier version -- two records for one real-world expense
-- each look independently unreimbursed."
--
-- E2's inclusion lock stops ONE expense entering two requests. It cannot stop
-- TWO expense records for one real charge entering one request each, because
-- from the lock's point of view they are different expenses. That gap is
-- closed here or not at all.
--
-- Measured against this schema before writing it: a $240 dental visit entered
-- manually the evening of the appointment, then delivered by Plaid four days
-- later when the card settled, yields two eligible + unclaimed expenses
-- totalling $480 of claimable money for $240 of real spending. Nothing warned.
--
-- The spec names three directions. They are NOT equally dangerous, and the
-- honest answer for two of them is that the schema already handles them:
--
--   1. Sync vs sync (Plaid re-delivering a transaction).
--      Already impossible. transactions.plaid_transaction_id carries a UNIQUE
--      constraint and ingestion upserts on it; invoices.source_plaid_transaction_id
--      carries a partial unique index, which is what makes autoCapture's 23505
--      fallback correct. No new machinery is warranted, and adding heuristic
--      detection on top of a database guarantee would only produce false
--      positives.
--
--   2. Pending vs posted.
--      Plaid resolves this itself: when a pending transaction posts, the
--      pending id arrives in `removed` and the posted transaction arrives in
--      `added` carrying pending_transaction_id. The danger is not detection,
--      it is LOST WORK -- our removal handler deliberately keeps an invoice
--      that has receipts attached, so a user who substantiated the pending
--      charge ends up with an orphaned documented expense plus a fresh
--      auto-captured one. Handled by relink_pending_expense below, which is
--      an automatic merge precisely because Plaid states the link as fact
--      rather than us guessing at it.
--
--   3. Manual entry vs synced transaction.
--      Entirely unguarded, and the one that actually costs money. This is what
--      the candidate table and detection function exist for.
--
-- Nothing here merges on a heuristic. Detection only ever raises a candidate;
-- a human decides. A false-positive auto-merge would silently destroy a real
-- expense, which is strictly worse than the double-count being warned about.

-- ── 1. Pending-transaction linkage ────────────────────────────────────────
-- Ingestion previously discarded both fields. Storing them is what lets a
-- posted transaction find the pending row the user already worked on.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_plaid_transaction_id TEXT;

COMMENT ON COLUMN public.transactions.is_pending IS
  'Plaid''s `pending` flag. A pending charge can change amount or vanish
   entirely before it settles, so anything derived from it is provisional.';
COMMENT ON COLUMN public.transactions.pending_plaid_transaction_id IS
  'Plaid''s `pending_transaction_id`: on a posted transaction, the id of the
   pending row it replaces. Authoritative -- Plaid states the link, we do not
   infer it -- which is why relink_pending_expense may act without asking.';

CREATE INDEX IF NOT EXISTS idx_transactions_pending_link
  ON public.transactions (user_id, pending_plaid_transaction_id)
  WHERE pending_plaid_transaction_id IS NOT NULL;

-- ── 2. Candidate types ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duplicate_match_reason') THEN
    CREATE TYPE public.duplicate_match_reason AS ENUM (
      -- One record from manual entry, one from bank sync. The expensive case:
      -- manual entry records DATE OF SERVICE while Plaid records DATE OF
      -- PAYMENT, so the two rows rarely share a date and no naive exact-match
      -- check would ever pair them.
      'manual_vs_synced',
      -- Both records came from bank sync, or both were entered by hand. Same
      -- merchant, same amount, near dates. Genuinely ambiguous -- two $20
      -- copays for two children on one day look exactly like this -- so it is
      -- raised at lower confidence and never merged without a human.
      'same_charge'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duplicate_status') THEN
    CREATE TYPE public.duplicate_status AS ENUM (
      'open',       -- awaiting the user
      'dismissed'   -- user confirmed these are genuinely distinct
      -- Deliberately no 'merged': merging deletes the discarded expense, and
      -- the FKs below cascade, so a merged candidate row removes itself. The
      -- merge is recorded on the surviving expense instead, where a user
      -- reading that expense will actually see it.
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.expense_duplicate_candidates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Canonically ordered so the same pair cannot be stored twice in mirror
  -- image, which is what makes the unique constraint below meaningful and
  -- lets a dismissal be permanent.
  expense_a_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  expense_b_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  match_reason public.duplicate_match_reason NOT NULL,
  confidence   INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status       public.duplicate_status NOT NULL DEFAULT 'open',
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CONSTRAINT expense_duplicate_candidates_ordered CHECK (expense_a_id < expense_b_id),
  CONSTRAINT expense_duplicate_candidates_pair_unique
    UNIQUE (user_id, expense_a_id, expense_b_id)
);

COMMENT ON TABLE public.expense_duplicate_candidates IS
  'Workstream C6: suspected pairs of expense records describing one real-world
   charge. A warning, never an action -- resolution is always a user decision.';

CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_open
  ON public.expense_duplicate_candidates (user_id, confidence DESC)
  WHERE status = 'open';

ALTER TABLE public.expense_duplicate_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own duplicate candidates"
  ON public.expense_duplicate_candidates;
CREATE POLICY "Users can view their own duplicate candidates"
  ON public.expense_duplicate_candidates FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own duplicate candidates"
  ON public.expense_duplicate_candidates;
CREATE POLICY "Users can update their own duplicate candidates"
  ON public.expense_duplicate_candidates FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own duplicate candidates"
  ON public.expense_duplicate_candidates;
CREATE POLICY "Users can delete their own duplicate candidates"
  ON public.expense_duplicate_candidates FOR DELETE
  USING (auth.uid() = user_id);

-- No INSERT policy on purpose. Rows are written only by detect_duplicate_expenses
-- below, which is SECURITY DEFINER and scopes every write to one user. A
-- client that could insert freely could fabricate a pairing between two
-- expenses and then merge them, destroying one.

-- ── 3. Detection ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.detect_duplicate_expenses(
  p_user_id                 UUID,
  p_cross_source_window_days INTEGER DEFAULT 14,
  p_same_source_window_days  INTEGER DEFAULT 3,
  p_tolerance                NUMERIC DEFAULT 0.01
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_found INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'detect_duplicate_expenses requires a user id';
  END IF;

  INSERT INTO expense_duplicate_candidates
    (user_id, expense_a_id, expense_b_id, match_reason, confidence)
  SELECT
    p_user_id,
    a.id,
    b.id,
    CASE WHEN a.is_synced <> b.is_synced
         THEN 'manual_vs_synced'::duplicate_match_reason
         ELSE 'same_charge'::duplicate_match_reason
    END,
    -- One hand-entered record and one from the bank is a near-certain double:
    -- the bank does not invent charges, and a user does not type in an amount
    -- to the cent by coincidence. Two records from the SAME source is the
    -- ambiguous case -- two copays for two children, a repeat prescription --
    -- so it is raised at a confidence that reads as "check this", not
    -- "this is wrong".
    CASE WHEN a.is_synced <> b.is_synced THEN 90 ELSE 60 END
  FROM (
    SELECT i.id, i.date, i.vendor, i.source_transaction_id,
           COALESCE(i.amount_paid, i.amount) AS paid,
           normalize_merchant_name(i.vendor)  AS merchant,
           (i.source_plaid_transaction_id IS NOT NULL) AS is_synced
      FROM invoices i
     WHERE i.user_id = p_user_id
       -- Only money still in play. An expense already locked into a request or
       -- reimbursed is E2's territory, and merging one would corrupt the
       -- immutable snapshot a submitted request depends on.
       AND i.claim_state IN ('unclaimed', 'not_reimbursable')
  ) a
  JOIN (
    SELECT i.id, i.date, i.vendor, i.source_transaction_id,
           COALESCE(i.amount_paid, i.amount) AS paid,
           normalize_merchant_name(i.vendor)  AS merchant,
           (i.source_plaid_transaction_id IS NOT NULL) AS is_synced
      FROM invoices i
     WHERE i.user_id = p_user_id
       AND i.claim_state IN ('unclaimed', 'not_reimbursable')
  ) b
    -- Canonical ordering, which also removes the self-join's mirror half.
    ON b.id > a.id
  WHERE a.merchant IS NOT NULL
    AND a.merchant = b.merchant
    AND ABS(a.paid - b.paid) <= p_tolerance
    AND ABS(a.date - b.date) <= CASE
          WHEN a.is_synced <> b.is_synced THEN p_cross_source_window_days
          ELSE p_same_source_window_days
        END
    -- Expenses split from one transaction are deliberately several records for
    -- one payment -- a $200 charge split evenly across two family members
    -- matches every other test here exactly. Flagging a split as a duplicate
    -- would invite the user to delete work they did on purpose.
    AND NOT (a.source_transaction_id IS NOT NULL
             AND a.source_transaction_id = b.source_transaction_id)
    AND NOT EXISTS (
      SELECT 1 FROM expense_duplicate_candidates c
       WHERE c.expense_a_id = a.id AND c.expense_b_id = b.id
    )
  -- The self-join can yield the same pair more than once only if invoices had
  -- duplicate ids, which the primary key forbids; ON CONFLICT is here so a
  -- concurrent detection run from the webhook and a manual sync cannot make
  -- either of them fail.
  ON CONFLICT ON CONSTRAINT expense_duplicate_candidates_pair_unique DO NOTHING;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found;
END;
$fn$;

COMMENT ON FUNCTION public.detect_duplicate_expenses(UUID, INTEGER, INTEGER, NUMERIC) IS
  'Workstream C6: raise candidate duplicate expense pairs. Never merges. The
   cross-source window is wider because manual entry records date of service
   while bank sync records date of payment.';

-- ── 4. Resolution: keep both ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_duplicate_candidate(p_candidate_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user UUID;
BEGIN
  SELECT user_id INTO v_user
    FROM expense_duplicate_candidates
   WHERE id = p_candidate_id;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Duplicate candidate not found';
  END IF;
  -- SECURITY DEFINER bypasses RLS, so ownership is checked by hand. Without
  -- this any authenticated user could dismiss another user's warnings.
  IF v_user <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE expense_duplicate_candidates
     SET status = 'dismissed', resolved_at = now()
   WHERE id = p_candidate_id;

  -- The row stays. Detection skips any pair that already has a candidate row,
  -- so a dismissal is permanent -- the user is not asked the same question
  -- after every sync.
  RETURN TRUE;
END;
$fn$;

COMMENT ON FUNCTION public.dismiss_duplicate_candidate(UUID) IS
  'Workstream C6: user confirms two expenses are genuinely distinct. Permanent
   -- the pair is never raised again.';

-- ── 5. Resolution: merge ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.merge_duplicate_expenses(
  p_candidate_id UUID,
  p_keep_id      UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user     UUID;
  v_a        UUID;
  v_b        UUID;
  v_drop_id  UUID;
  v_keep     invoices%ROWTYPE;
  v_drop     invoices%ROWTYPE;
  v_note     TEXT;
BEGIN
  SELECT user_id, expense_a_id, expense_b_id
    INTO v_user, v_a, v_b
    FROM expense_duplicate_candidates
   WHERE id = p_candidate_id
     AND status = 'open'
   FOR UPDATE;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Duplicate candidate not found or already resolved';
  END IF;
  IF v_user <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_keep_id NOT IN (v_a, v_b) THEN
    RAISE EXCEPTION 'The expense to keep must be one of the two in this pair';
  END IF;

  v_drop_id := CASE WHEN p_keep_id = v_a THEN v_b ELSE v_a END;

  -- Take both row locks in id order, never in keep/drop order. Two merges
  -- racing on an overlapping pair -- A+B and B+C, say -- would otherwise be
  -- able to grab the two locks in opposite orders and deadlock.
  PERFORM 1 FROM invoices WHERE id = LEAST(p_keep_id, v_drop_id) FOR UPDATE;
  PERFORM 1 FROM invoices WHERE id = GREATEST(p_keep_id, v_drop_id) FOR UPDATE;

  SELECT * INTO v_keep FROM invoices WHERE id = p_keep_id;
  SELECT * INTO v_drop FROM invoices WHERE id = v_drop_id;

  IF v_keep.id IS NULL OR v_drop.id IS NULL THEN
    RAISE EXCEPTION 'One of these expenses no longer exists';
  END IF;

  -- Re-checked here rather than trusting the state at detection time: a user
  -- can submit a reimbursement request between the warning appearing and their
  -- clicking merge. Deleting an expense that a submitted request references
  -- would break the snapshot that request depends on.
  IF v_drop.claim_state NOT IN ('unclaimed', 'not_reimbursable') THEN
    RAISE EXCEPTION
      'This expense has already been claimed and cannot be merged away';
  END IF;
  IF EXISTS (SELECT 1 FROM substantiation_record_items s WHERE s.invoice_id = v_drop.id) THEN
    RAISE EXCEPTION
      'This expense is part of a submitted reimbursement request and cannot be merged away';
  END IF;

  -- Documents move rather than die. This is the whole point of merging instead
  -- of asking the user to delete one: the hand-entered record usually carries
  -- the receipt, and the synced record usually carries the true amount paid.
  UPDATE receipts SET invoice_id = v_keep.id WHERE invoice_id = v_drop.id;

  -- Any transaction that pointed at the discarded expense now points at the
  -- survivor, so the bank row stays linked to something real.
  UPDATE transactions
     SET invoice_id = v_keep.id,
         reconciliation_status = 'linked_to_invoice'
   WHERE invoice_id = v_drop.id;

  -- Detach the discarded row's identity BEFORE deleting it. Both source
  -- columns carry unique indexes, so the survivor cannot adopt them while the
  -- discarded row still holds them.
  UPDATE invoices
     SET source_plaid_transaction_id = NULL,
         source_transaction_id       = NULL,
         source_email_message_id     = NULL
   WHERE id = v_drop.id;

  v_note := COALESCE(v_keep.notes || E'\n', '')
            || 'Merged with a duplicate record for the same charge ('
            || COALESCE(v_drop.vendor, 'unknown vendor') || ', '
            || TO_CHAR(v_drop.date, 'Mon DD YYYY') || ', $'
            || TO_CHAR(COALESCE(v_drop.amount_paid, v_drop.amount), 'FM999999990.00')
            || ') on ' || TO_CHAR(now(), 'Mon DD YYYY') || '.';

  UPDATE invoices SET
    -- Only ever fill gaps. Overwriting a value the user chose on the record
    -- they asked to KEEP would make merge feel like it destroyed their work.
    patient_name                = COALESCE(v_keep.patient_name, v_drop.patient_name),
    invoice_number              = COALESCE(v_keep.invoice_number, v_drop.invoice_number),
    npi_number                  = COALESCE(v_keep.npi_number, v_drop.npi_number),
    collection_id               = COALESCE(v_keep.collection_id, v_drop.collection_id),
    hsa_account_id              = COALESCE(v_keep.hsa_account_id, v_drop.hsa_account_id),
    payment_method_id           = COALESCE(v_keep.payment_method_id, v_drop.payment_method_id),
    eligibility_basis_rule_id   = COALESCE(v_keep.eligibility_basis_rule_id,
                                           v_drop.eligibility_basis_rule_id),
    -- The bank link is worth inheriting: it is what stops a future sync
    -- auto-capturing this charge a third time.
    source_plaid_transaction_id = COALESCE(v_keep.source_plaid_transaction_id,
                                           v_drop.source_plaid_transaction_id),
    source_transaction_id       = COALESCE(v_keep.source_transaction_id,
                                           v_drop.source_transaction_id),
    -- Documentation is a fact about which files exist, and the files just
    -- moved, so take the better of the two.
    documentation_state = (
      SELECT s FROM (VALUES (v_keep.documentation_state), (v_drop.documentation_state)) AS t(s)
       ORDER BY CASE s WHEN 'complete' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END
       LIMIT 1
    ),
    -- Eligibility is a judgement, so an unresolved survivor may inherit a
    -- decision, but a decided survivor is never overruled by the discarded row.
    eligibility_state = CASE
      WHEN v_keep.eligibility_state = 'unknown' THEN v_drop.eligibility_state
      ELSE v_keep.eligibility_state
    END,
    notes      = v_note,
    updated_at = now()
  WHERE id = v_keep.id;

  -- Cascades through the candidate rows referencing it, including this one.
  -- That is intentional: the duplicate no longer exists, so there is nothing
  -- left to warn about, and the merge is recorded in the survivor's notes
  -- where the user will actually read it.
  DELETE FROM invoices WHERE id = v_drop.id;

  RETURN v_keep.id;
END;
$fn$;

COMMENT ON FUNCTION public.merge_duplicate_expenses(UUID, UUID) IS
  'Workstream C6: fold a duplicate expense into the one the user chose to keep.
   Documents and the bank link move across; values on the surviving record are
   never overwritten, only gaps filled.';

-- ── 6. Pending → posted relink ────────────────────────────────────────────
-- The one automatic case. Plaid states the link via pending_transaction_id, so
-- this is not a guess and does not need a human.

CREATE OR REPLACE FUNCTION public.relink_pending_expense(
  p_user_id     UUID,
  p_pending_id  TEXT,
  p_posted_id   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_expense_id UUID;
  v_posted_row UUID;
BEGIN
  IF p_user_id IS NULL OR p_pending_id IS NULL OR p_posted_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_expense_id
    FROM invoices
   WHERE user_id = p_user_id
     AND source_plaid_transaction_id = p_pending_id
   FOR UPDATE;

  IF v_expense_id IS NULL THEN
    RETURN NULL;   -- nothing was captured from the pending charge
  END IF;

  -- If the posted charge somehow already has its own expense, leave both alone
  -- and let detection raise it as a candidate. Silently deleting one here
  -- would be an auto-merge on an assumption, which is exactly what this
  -- migration refuses to do everywhere else.
  IF EXISTS (
    SELECT 1 FROM invoices
     WHERE user_id = p_user_id
       AND source_plaid_transaction_id = p_posted_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_posted_row
    FROM transactions
   WHERE user_id = p_user_id
     AND plaid_transaction_id = p_posted_id;

  UPDATE invoices
     SET source_plaid_transaction_id = p_posted_id,
         source_transaction_id       = COALESCE(v_posted_row, source_transaction_id),
         updated_at                  = now()
   WHERE id = v_expense_id;

  IF v_posted_row IS NOT NULL THEN
    UPDATE transactions
       SET invoice_id = v_expense_id,
           reconciliation_status = 'linked_to_invoice'
     WHERE id = v_posted_row;
  END IF;

  RETURN v_expense_id;
END;
$fn$;

COMMENT ON FUNCTION public.relink_pending_expense(UUID, TEXT, TEXT) IS
  'Workstream C6: move an expense captured from a pending charge onto the
   posted charge that replaced it, so receipts and edits survive settlement
   instead of being orphaned while a second expense is auto-captured.';

GRANT EXECUTE ON FUNCTION public.detect_duplicate_expenses(UUID, INTEGER, INTEGER, NUMERIC)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_duplicate_candidate(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_expenses(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relink_pending_expense(UUID, TEXT, TEXT) TO service_role;
