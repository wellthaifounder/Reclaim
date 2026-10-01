-- Substantiate slice 2: deciding in the dialog (SUBSTANTIATE_SPEC S32, S34).
--
-- Two small facts the Medical Expense Record has to be able to state, and the
-- database did not yet keep.
--
-- ── 1. "I don't have one" (S34) ───────────────────────────────────────────
-- A confirmed expense with no document used to stay in needs_receipt for good,
-- so one lost receipt meant the queue could never reach zero. The person can
-- now say so, and the record says plainly "No receipt, bank record only."
--
-- It is a fourth DOCUMENTATION state rather than a flag beside it, for three
-- reasons that all come from the existing machinery:
--
--   * sync_invoice_lifecycle_status already does the right thing with no
--     change. needs_receipt is "eligible AND documentation_state = 'none'", so
--     an eligible expense in this state falls through to 'eligible' and leaves
--     the queue; an undecided one is "documentation_state <> 'none'" and lands
--     in pending_review -- still waiting for its decision, which is true.
--   * "Attaching a document later clears it" is free: sync_expense_documentation_state
--     recomputes from the attached files and writes 'complete'. Removing that
--     document again returns the expense to 'none' and to the queue, which is
--     also right.
--   * substantiation_record_items already snapshots documentation_state as
--     text (documentation_state_at_submission), so a record rebuilt months
--     later still says what was true when it was filed.
--
-- Everything that asks "is it documented?" tests for 'complete' or for 'none',
-- and this is neither, so it is never mistaken for proof. The claim packet
-- still lists such an expense among the undocumented, which is accurate.
--
-- ALTER TYPE ... ADD VALUE may not be USED in the transaction that adds it, so
-- nothing below mentions the new value.

ALTER TYPE public.expense_documentation_state ADD VALUE IF NOT EXISTS 'not_available';

-- ── 2. "Your judgement, against the list" (S32) ───────────────────────────
-- Confirming an expense the IRS Publication 502 list says is not allowed is
-- now possible, behind one extra step, and the record must say it was the
-- account holder's judgement. Whether the list says that is a property of the
-- rule, so it is carried alongside the rule the record already names. Both
-- reads already join pub_502_rules; this adds the one column.
--
-- The superset the record generator reads. Verbatim from 20260916120000 plus
-- rule_status, appended last. A function's result columns cannot change under
-- CREATE OR REPLACE, so it is dropped and recreated in this one transaction;
-- claimable_expenses() below is a thin filter over it that names its columns,
-- so it is untouched and keeps working for the frontend still deployed.

DROP FUNCTION IF EXISTS public.substantiatable_expenses();
CREATE FUNCTION public.substantiatable_expenses()
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
    -- Spec D30-D31: a draft (record_status='generated') no longer counts as
    -- "already claimed". Only a SENT or reimbursed claim does.
    (
      i.claim_state = 'unclaimed'
      AND GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                   - COALESCE(i.reimbursed_amount, 0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM substantiation_record_items sri
         WHERE sri.invoice_id = i.id
           AND sri.record_status IN ('sent', 'reimbursed')
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

COMMENT ON FUNCTION public.substantiatable_expenses() IS
  'Every expense confirmed eligible, whatever has happened to the money since -- the set a Medical Expense Record may cover. claimable = the narrower set a reimbursement claim may cover. Excludes reimbursed_externally: no HSA distribution occurred, so there is nothing to substantiate. rule_status is what the Publication 502 list says about the matched category, so the record can state when the holder confirmed against it.';

GRANT EXECUTE ON FUNCTION public.substantiatable_expenses() TO authenticated;

-- The same column on the rebuilt-packet read. It reads the SNAPSHOT for
-- everything a person could have edited, but the rule table is reference data
-- keyed by the id the snapshot kept, so the status comes from the join it
-- already makes.

DROP FUNCTION IF EXISTS public.record_packet_items(UUID);
CREATE FUNCTION public.record_packet_items(p_record_id UUID)
RETURNS TABLE (
  invoice_id          UUID,
  vendor              TEXT,
  service_date        DATE,
  category            TEXT,
  patient_name        TEXT,
  amount              NUMERIC,
  rule_id             TEXT,
  rule_name           TEXT,
  rule_section_ref    TEXT,
  confirmed_at        TIMESTAMPTZ,
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
    sri.invoice_id,
    sri.vendor_at_submission,
    sri.date_at_submission,
    sri.category_at_submission,
    sri.patient_name_at_submission,
    sri.amount_at_submission,
    sri.eligibility_basis_rule_id_at_submission,
    pr.name,
    pr.section_ref,
    sri.confirmed_at_at_submission,
    sri.documentation_state_at_submission,
    sri.document_manifest_at_submission,
    pr.eligibility_status
  FROM substantiation_record_items sri
  JOIN substantiation_records sr
    ON sr.id = sri.substantiation_record_id
  LEFT JOIN pub_502_rules pr
    ON pr.id = sri.eligibility_basis_rule_id_at_submission
  -- SECURITY DEFINER bypasses RLS, so ownership is checked here explicitly.
  -- Without this line any signed-in user could read any record's contents by
  -- passing its id.
  WHERE sri.substantiation_record_id = p_record_id
    AND sr.user_id = auth.uid()
  ORDER BY sri.date_at_submission ASC, sri.vendor_at_submission ASC;
$fn$;

COMMENT ON FUNCTION public.record_packet_items(UUID) IS
  'Workstream E3: the snapshot rows behind one substantiation record, for
   rebuilding its claim packet. Ordered to match claimable_expenses() so a
   rebuilt packet numbers its expenses the same way the original did.';

GRANT EXECUTE ON FUNCTION public.record_packet_items(UUID) TO authenticated;
