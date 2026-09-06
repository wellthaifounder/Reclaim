-- Let one document substantiate several expenses.
--
-- Until now `receipts.invoice_id` was a single nullable foreign key: a
-- document could belong to at most one expense. Attaching an
-- already-uploaded document to a second expense (via AttachDocumentDialog)
-- silently REPOINTED it, detaching it from the first -- an audit problem on
-- a product whose whole claim is audit-defensibility, and the exact case a
-- hospital bill paid in three instalments needs solved: one itemised
-- statement substantiating three separate bank transactions.
--
-- This migration adds `receipt_invoices`, a proper many-to-many join table,
-- and makes it the one place every "does this expense have documentation"
-- check reads from. `receipts.invoice_id` is NOT dropped: every existing
-- insert path (SubstantiateDialog's upload, BillDetail's upload, manual
-- entry, the inbound-email pipeline) still sets it at creation time, and a
-- new trigger mirrors that into the join table automatically, so none of
-- those call sites need to change. Going forward `receipts.invoice_id` means
-- "which expense this document was originally uploaded for" -- a provenance
-- fact, not the live source of truth for attachment. Its removal is
-- deliberately not in this migration; per CLAUDE.md's 2026-04-24 lesson, that
-- needs its own follow-up migration once every reader has moved off it, not
-- a comment promising to get to it.
--
-- ── 1. The join table ───────────────────────────────────────────────────────
-- Composite PK, user_id denormalised onto the row: the same shape as
-- expense_tags (20260816220000_substantiation.sql), the only other
-- many-to-many junction table in this schema.

CREATE TABLE IF NOT EXISTS public.receipt_invoices (
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_receipt_invoices_invoice
  ON public.receipt_invoices (invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipt_invoices_user
  ON public.receipt_invoices (user_id);

ALTER TABLE public.receipt_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own receipt invoices" ON public.receipt_invoices;
CREATE POLICY "Users can view their own receipt invoices"
  ON public.receipt_invoices FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own receipt invoices" ON public.receipt_invoices;
CREATE POLICY "Users can insert their own receipt invoices"
  ON public.receipt_invoices FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own receipt invoices" ON public.receipt_invoices;
CREATE POLICY "Users can delete their own receipt invoices"
  ON public.receipt_invoices FOR DELETE USING (auth.uid() = user_id);

-- ── 2. Backfill ──────────────────────────────────────────────────────────────
-- Every existing single attachment becomes the document's first row here.

INSERT INTO public.receipt_invoices (receipt_id, invoice_id, user_id)
SELECT r.id, r.invoice_id, r.user_id
  FROM public.receipts r
 WHERE r.invoice_id IS NOT NULL
ON CONFLICT (receipt_id, invoice_id) DO NOTHING;

-- ── 3. Keep new uploads working with no call-site changes ─────────────────
-- Every current insert path sets receipts.invoice_id at creation. Mirroring
-- that into the join table here, once, means none of those call sites (the
-- substantiate dialog's upload, the bill detail page, manual entry, the
-- inbound-email pipeline) has to be touched. Invoker rights on purpose, to
-- match sync_expense_documentation_state's own reasoning below: the row
-- being inserted already belongs to the same statement's auth context, so
-- RLS on receipt_invoices enforces itself correctly without SECURITY
-- DEFINER punching through it.

CREATE OR REPLACE FUNCTION public.seed_receipt_invoice_from_legacy_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    INSERT INTO public.receipt_invoices (receipt_id, invoice_id, user_id)
    VALUES (NEW.id, NEW.invoice_id, NEW.user_id)
    ON CONFLICT (receipt_id, invoice_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipts_seed_join ON public.receipts;
CREATE TRIGGER trg_receipts_seed_join
  AFTER INSERT ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.seed_receipt_invoice_from_legacy_column();

-- ── 4. Documentation state reads the join table, not the legacy column ────

CREATE OR REPLACE FUNCTION public.sync_expense_documentation_state(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE invoices i
     SET documentation_state = (
           CASE
             WHEN EXISTS (SELECT 1 FROM receipt_invoices ri WHERE ri.invoice_id = i.id)
               THEN 'complete'
             -- A mileage log has no receipt and never will. Its own trigger
             -- (apply_mileage_derived) marks it complete at entry time; this
             -- clause is what keeps that true after any later recompute.
             WHEN i.mileage_miles IS NOT NULL
               THEN 'complete'
             ELSE 'none'
           END
         )::expense_documentation_state,
         updated_at = now()
   WHERE i.id = p_invoice_id
     -- Row-level security governs which invoices the caller can touch. Left
     -- with the caller's own privileges on purpose: elevating this function's
     -- rights would let a receipt pointed at someone else's invoice reach
     -- across the boundary.
     AND i.documentation_state IS DISTINCT FROM (
           CASE
             WHEN EXISTS (SELECT 1 FROM receipt_invoices ri WHERE ri.invoice_id = i.id)
               THEN 'complete'
             WHEN i.mileage_miles IS NOT NULL
               THEN 'complete'
             ELSE 'none'
           END
         )::expense_documentation_state;
END;
$fn$;

-- The existing receipts-table trigger still fires on every insert (including
-- the mirrored ones from step 3) and on the merge function's legacy-column
-- UPDATE -- harmless now that the function above reads receipt_invoices, not
-- receipts.invoice_id, so left exactly as it was.
--
-- What that trigger does NOT see is an attachment made directly through the
-- join table -- the multi-attach path added below in step 6. This is that
-- trigger's sibling.

CREATE OR REPLACE FUNCTION public.propagate_documentation_change_ri()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_expense_documentation_state(OLD.invoice_id);
    RETURN OLD;
  END IF;
  PERFORM sync_expense_documentation_state(NEW.invoice_id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipt_invoices_documentation ON public.receipt_invoices;
CREATE TRIGGER trg_receipt_invoices_documentation
  AFTER INSERT OR DELETE ON public.receipt_invoices
  FOR EACH ROW EXECUTE FUNCTION public.propagate_documentation_change_ri();

-- apply_mileage_derived's "did the log stop being a mileage entry, and if so
-- is there still real documentation" check has the same read to fix.

CREATE OR REPLACE FUNCTION public.apply_mileage_derived()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_amount NUMERIC;
BEGIN
  IF NEW.mileage_miles IS NOT NULL THEN
    IF NEW.documentation_state = 'none' THEN
      NEW.documentation_state := 'complete';
    END IF;

    IF NEW.mileage_rate IS NOT NULL THEN
      -- Parking and tolls are added AFTER rounding the drive, because they are
      -- a separate claim under Pub. 502 rather than part of the per-mile
      -- figure.
      v_amount := ROUND(NEW.mileage_miles * NEW.mileage_rate, 2)
                  + COALESCE(NEW.mileage_parking_tolls, 0);
      NEW.amount      := v_amount;
      NEW.amount_paid := v_amount;

      -- Reimbursable follows the trip, except that a user is always free to
      -- claim less. Reset it when the trip itself changes, and clamp it when
      -- it would otherwise exceed what the trip is worth.
      IF TG_OP = 'INSERT'
         OR NEW.mileage_miles         IS DISTINCT FROM OLD.mileage_miles
         OR NEW.mileage_rate          IS DISTINCT FROM OLD.mileage_rate
         OR NEW.mileage_parking_tolls IS DISTINCT FROM OLD.mileage_parking_tolls
         OR NEW.reimbursable_amount IS NULL
         OR NEW.reimbursable_amount > v_amount
      THEN
        NEW.reimbursable_amount := v_amount;
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND OLD.mileage_miles IS NOT NULL THEN
    -- It stopped being a mileage entry. The log that stood in for a receipt
    -- is gone with it, so the claim reverts to undocumented unless a real
    -- document has since been attached.
    IF NOT EXISTS (SELECT 1 FROM receipt_invoices ri WHERE ri.invoice_id = NEW.id) THEN
      NEW.documentation_state := 'none';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.apply_mileage_derived() IS
  'Workstream D6: the mileage arithmetic, in one place. Also marks a mileage
   log as its own documentation.';

-- ── 5. The substantiation checklist counts through the join table ─────────

CREATE OR REPLACE FUNCTION public.expense_substantiation_status(p_invoice_id UUID)
RETURNS TABLE (
  is_complete       BOOLEAN,
  missing           TEXT[],
  document_count    INTEGER,
  has_service_date  BOOLEAN,
  has_patient       BOOLEAN,
  blocking_gate     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec     RECORD;
  v_docs    INTEGER;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_gate    TEXT;
BEGIN
  SELECT i.user_id, i.service_date, i.patient_id, i.eligibility_state,
         i.ineligible_reason, i.mileage_miles, i.notes
    INTO v_rec
    FROM invoices i WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*) INTO v_docs FROM receipt_invoices ri WHERE ri.invoice_id = p_invoice_id;

  -- Phrased as what the IRS would want to see in an audit, not as internal
  -- field names -- this is read back to the user verbatim.
  IF v_rec.mileage_miles IS NOT NULL THEN
    IF v_rec.notes IS NULL OR BTRIM(v_rec.notes) = '' THEN
      v_missing := array_append(v_missing, 'what the trip was for');
    END IF;
  ELSIF v_docs = 0 THEN
    v_missing := array_append(v_missing, 'a receipt or itemised statement');
  END IF;

  IF v_rec.service_date IS NULL THEN
    v_missing := array_append(v_missing, 'the date the care happened');
  END IF;
  IF v_rec.patient_id IS NULL THEN
    v_missing := array_append(v_missing, 'who the care was for');
  END IF;

  IF v_rec.eligibility_state = 'ineligible' THEN
    v_gate := v_rec.ineligible_reason;
  ELSIF v_rec.eligibility_state = 'conditional' THEN
    v_gate := 'needs_letter_of_medical_necessity';
  END IF;

  RETURN QUERY SELECT
    (ARRAY_LENGTH(v_missing, 1) IS NULL AND v_gate IS NULL),
    v_missing,
    v_docs,
    (v_rec.service_date IS NOT NULL),
    (v_rec.patient_id IS NOT NULL),
    v_gate;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.expense_substantiation_status(UUID) TO authenticated;

-- ── 6. The reimbursement packet's document manifest ────────────────────────
-- claimable_expenses() builds the actual file list a generated record bundles
-- and cites -- a shared hospital bill needs to appear in every packet it
-- substantiates, not just the first one built.

CREATE OR REPLACE FUNCTION public.claimable_expenses()
RETURNS TABLE (
  invoice_id          UUID,
  vendor              TEXT,
  service_date        DATE,
  tax_year            INTEGER,
  category            TEXT,
  patient_name        TEXT,
  remaining_amount    NUMERIC,
  confirmed_at        TIMESTAMPTZ,
  rule_id             TEXT,
  rule_name           TEXT,
  rule_section_ref    TEXT,
  documentation_state TEXT,
  documents           JSONB
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
    i.documentation_state,
    -- The document set, not a count: the record's PDF embeds these images and
    -- the packet bundles the files themselves. A second round trip for them
    -- would let the picker and the packet disagree about what is attached.
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
    )
  FROM invoices i
  LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
  WHERE i.user_id = auth.uid()
    AND i.eligibility_state = 'eligible'
    AND i.claim_state = 'unclaimed'
    AND GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                 - COALESCE(i.reimbursed_amount, 0), 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM substantiation_record_items sri
       WHERE sri.invoice_id = i.id
         AND sri.record_status <> 'voided'
    )
  ORDER BY i.effective_service_date ASC, i.vendor ASC;
$fn$;

-- substantiation_record_items.document_manifest_at_submission snapshots this
-- output at generation time and is never re-read from the live tables after
-- that -- exactly right, and untouched here.

-- ── 7. The letter-of-medical-necessity gate ────────────────────────────────
-- Gate 3 (recompute_expense_eligibility) and its reporting twin
-- (expense_pub502_gate) both ask "does this expense have an attached LMN".
-- Missing this would silently strand a conditional expense: attaching the
-- letter through the multi-attach path would never clear it.

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
     AND (t.confirmed_at IS NULL OR t.is_factual_refusal);

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

  DROP TABLE IF EXISTS _verdicts;
  RETURN QUERY SELECT v_blocked, v_restored;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.expense_pub502_gate(p_invoice_id UUID)
RETURNS TABLE (
  status      TEXT,
  rule_id     TEXT,
  rule_name   TEXT,
  reason      TEXT,
  lmn_prompt  TEXT,
  has_lmn     BOOLEAN,
  confidence  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec RECORD;
  v_lmn BOOLEAN;
BEGIN
  SELECT i.user_id, i.eligibility_basis_rule_id, i.classification_reasoning,
         i.classification_confidence,
         pr.name AS rule_name, pr.eligibility_status, pr.conditions, pr.lmn_prompt
    INTO v_rec
    FROM invoices i
    LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
   WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM receipt_invoices ri
    JOIN receipts r ON r.id = ri.receipt_id
     WHERE ri.invoice_id = p_invoice_id
       AND r.document_type = 'letter_of_medical_necessity'
  ) INTO v_lmn;

  IF v_rec.eligibility_basis_rule_id IS NULL THEN
    RETURN QUERY SELECT
      'unknown'::TEXT, NULL::TEXT, NULL::TEXT,
      'We have not worked out what kind of expense this is yet. Add your documents and we will.'::TEXT,
      NULL::TEXT, v_lmn, NULL::NUMERIC;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_rec.eligibility_status, 'unknown')::TEXT,
    v_rec.eligibility_basis_rule_id,
    v_rec.rule_name,
    -- The classifier's own sentence is preferred: it is specific to this
    -- expense, where the rule's `conditions` is generic to the category.
    COALESCE(
      NULLIF(v_rec.classification_reasoning, ''),
      v_rec.conditions,
      'Matched to ' || COALESCE(v_rec.rule_name, 'a Pub 502 category') || '.'
    )::TEXT,
    CASE WHEN v_rec.eligibility_status = 'conditional' AND NOT v_lmn
         THEN v_rec.lmn_prompt ELSE NULL END,
    v_lmn,
    v_rec.classification_confidence;
END;
$fn$;

-- The existing receipts-table LMN trigger (trg_receipts_lmn, AFTER INSERT OR
-- DELETE, propagate_lmn_change) covers a letter uploaded fresh for this
-- expense. This is its sibling for a letter attached through the multi-attach
-- path -- an LMN uploaded for one expense and later reused for a second.

CREATE OR REPLACE FUNCTION public.propagate_lmn_change_ri()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_invoice UUID;
  v_user    UUID;
  v_doctype TEXT;
BEGIN
  v_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_type INTO v_doctype
    FROM receipts WHERE id = COALESCE(NEW.receipt_id, OLD.receipt_id);
  IF v_doctype IS DISTINCT FROM 'letter_of_medical_necessity' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT user_id INTO v_user FROM invoices WHERE id = v_invoice;
  IF v_user IS NOT NULL THEN
    PERFORM public.recompute_expense_eligibility(v_user, ARRAY[v_invoice]);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipt_invoices_lmn ON public.receipt_invoices;
CREATE TRIGGER trg_receipt_invoices_lmn
  AFTER INSERT OR DELETE ON public.receipt_invoices
  FOR EACH ROW EXECUTE FUNCTION public.propagate_lmn_change_ri();

-- ── 8. Merging duplicate expenses moves attachments, not just the legacy
--       column ────────────────────────────────────────────────────────────
-- merge_duplicate_expenses() already moves a receipt's legacy invoice_id from
-- the discarded row to the survivor ("documents move rather than die"). A
-- receipt attached only through the join table needs the same treatment, or
-- a merge would quietly drop its second attachment. The join-table rows
-- still pointed at the discarded invoice are cleaned up for free by its
-- ON DELETE CASCADE when the discarded invoice row is deleted below, so
-- there is nothing to delete here -- only something to copy first.

CREATE OR REPLACE FUNCTION public.merge_duplicate_expenses(
  p_candidate_id uuid,
  p_keep_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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

  -- Every join-table attachment moves too, not just the legacy column above.
  -- ON CONFLICT DO NOTHING: a receipt already attached to both sides of the
  -- merge keeps a single row on the survivor rather than erroring.
  INSERT INTO receipt_invoices (receipt_id, invoice_id, user_id)
  SELECT ri.receipt_id, v_keep.id, ri.user_id
    FROM receipt_invoices ri
   WHERE ri.invoice_id = v_drop.id
  ON CONFLICT (receipt_id, invoice_id) DO NOTHING;

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
    hsa_account_id              = COALESCE(v_keep.hsa_account_id, v_drop.hsa_account_id),
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
$function$;
