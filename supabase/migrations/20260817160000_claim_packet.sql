-- Workstream E3 — the claim packet.
--
-- The spec's v1 deliverable for Step 3: "An exportable ZIP containing all
-- supporting documentation for the included expenses, a computed reimbursement
-- total, a cover summary listing each expense with patient, date of service,
-- provider, category, Pub 502 basis, amount, and the Reclaim confirmation
-- timestamp, and custodian-specific submission instructions where known."
--
-- The ZIP itself is built in the browser (see src/lib/claimPacket.ts) -- the
-- client already holds authorised access to exactly these files, and building
-- server-side would mean assembling a PHI-laden archive in an edge function and
-- persisting it somewhere. This migration supplies the four things the database
-- has to own for that packet to be correct:
--
--   1. WHO IT IS ADDRESSED TO. Submission instructions need a custodian, and
--      nothing in the schema recorded one -- the retired legacy flow asked for
--      it on the form every single time. Remembered on the profile, snapshotted
--      onto the record.
--
--   2. THE GATE 4 ATTESTATION. From the spec: "honor system, one checkbox on
--      the request, not a workflow step: the expense was not deducted on
--      Schedule A and was not reimbursed by an FSA or HRA." It had no home. It
--      belongs on the request, because that is the moment the user asserts it,
--      and the packet's defensibility claim is weaker without it.
--
--   3. THE DOCUMENT LIST AS IT STOOD AT SUBMISSION. Every other field on
--      substantiation_record_items is a snapshot for exactly this reason, but
--      the documents were not, so a record could not rebuild its own packet
--      once a receipt was deleted or reattached elsewhere -- and the records
--      page already promises the user they can re-download at any time.
--
--   4. WHETHER AN EXPENSE WITH NO ATTACHED FILE IS ACTUALLY MISSING ONE.
--      Medical mileage (D6) is substantiated by its trip log, not by a receipt,
--      and is deliberately marked documentation_state='complete' with zero
--      files. Without that column the packet would tell the custodian a
--      correctly documented mileage claim was missing paperwork.

-- ── 1. The custodian ──────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hsa_custodian TEXT;

COMMENT ON COLUMN public.profiles.hsa_custodian IS
  'Workstream E3: the user''s HSA custodian, remembered so the claim packet''s
   submission instructions do not have to be re-picked on every claim. Free
   text rather than an enum -- the list in src/lib/custodianInstructions.ts is
   the ones we have verified guidance for, not the ones that exist.';

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS custodian TEXT;

COMMENT ON COLUMN public.substantiation_records.custodian IS
  'Workstream E3: who this claim was addressed to, snapshotted at generation.
   The record is an immutable account of what was submitted where; later
   changing custodians must not rewrite where an old claim went.';

-- ── 2. Gate 4: the no-double-benefit attestation ──────────────────────────

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS attested_no_double_benefit BOOLEAN NOT NULL
    DEFAULT FALSE;

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.substantiation_records.attested_no_double_benefit IS
  'Workstream E3 / spec Gate 4: the user confirmed that no expense in this
   claim was deducted on Schedule A or reimbursed by an FSA or HRA. Defaults
   FALSE, which is the truthful value for every record generated before the
   checkbox existed -- including the legacy requests E1 migrated in. Never
   backfilled to TRUE: an attestation nobody made is not an attestation.';

COMMENT ON COLUMN public.substantiation_records.attested_at IS
  'When the attestation was made. Sits alongside the per-expense confirmation
   timestamps as part of the audit trail.';

-- ── 3. The document manifest, snapshotted ─────────────────────────────────

ALTER TABLE public.substantiation_record_items
  ADD COLUMN IF NOT EXISTS document_manifest_at_submission JSONB NOT NULL
    DEFAULT '[]'::JSONB;

COMMENT ON COLUMN public.substantiation_record_items.document_manifest_at_submission IS
  'Workstream E3: [{path, type, description}] for every document attached to
   the expense when the record was generated. Stored rather than re-derived so
   a packet rebuilt months later contains -- and names -- the same files as the
   one the custodian received. Paths are storage keys in the receipts bucket,
   not URLs; nothing here is a credential.';

ALTER TABLE public.substantiation_record_items
  ADD COLUMN IF NOT EXISTS documentation_state_at_submission TEXT;

COMMENT ON COLUMN public.substantiation_record_items.documentation_state_at_submission IS
  'Workstream E3: invoices.documentation_state at generation time. Lets the
   packet distinguish "no file because none applies" (medical mileage, which is
   substantiated by its trip log) from "no file because one is missing".';

-- Best-effort backfill for records generated before this column existed,
-- including the legacy requests E1 migrated in. This reads TODAY'S documents,
-- which is a reconstruction rather than a snapshot -- but the alternative is an
-- empty manifest on every historical record, and today's set is the closest
-- true statement available. Only rows still holding the default are touched,
-- so re-running changes nothing.
UPDATE public.substantiation_record_items sri
   SET document_manifest_at_submission = COALESCE(
         (SELECT JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'path', r.file_path,
                     'type', r.document_type,
                     'description', r.description)
                   ORDER BY r.uploaded_at)
            FROM public.receipts r
           WHERE r.invoice_id = sri.invoice_id),
         '[]'::JSONB)
 WHERE sri.document_manifest_at_submission = '[]'::JSONB;

UPDATE public.substantiation_record_items sri
   SET documentation_state_at_submission = i.documentation_state
  FROM public.invoices i
 WHERE i.id = sri.invoice_id
   AND sri.documentation_state_at_submission IS NULL;

-- ── 4. claimable_expenses(): documents, not just paths ────────────────────
-- Same selectability rule as E2, unchanged. What changes is what comes back
-- with each expense: the document TYPE and description as well as the path, so
-- the packet can name a file "02-itemized-statement.pdf" rather than
-- "02-document.pdf", and documentation_state so it can tell a mileage claim
-- from an undocumented one.

DROP FUNCTION IF EXISTS public.claimable_expenses();
CREATE FUNCTION public.claimable_expenses()
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
         FROM receipts r WHERE r.invoice_id = i.id),
      '[]'::JSONB
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
  -- Deterministic, and the same order the packet numbers its folders in, so
  -- "Expense 3 of 7" in the PDF and "03-..." in the documents folder always
  -- refer to the same expense.
  ORDER BY i.effective_service_date ASC, i.vendor ASC;
$fn$;

COMMENT ON FUNCTION public.claimable_expenses() IS
  'Workstream E2/E3: the spec''s selectability rule in one place -- eligible,
   unclaimed, remaining > 0, and not already inside a live claim -- plus the
   document set each expense carries, so the picker, the record PDF and the
   claim packet cannot disagree about what is attached.';

GRANT EXECUTE ON FUNCTION public.claimable_expenses() TO authenticated;

-- ── 5. record_packet_items(): rebuilding a past packet ────────────────────
-- Reads the SNAPSHOT, never the live invoice. A record downloaded again months
-- later has to contain what the custodian was sent, not what the expense looks
-- like now -- otherwise the second copy quietly contradicts the first.

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
  documents           JSONB
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
    sri.document_manifest_at_submission
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
