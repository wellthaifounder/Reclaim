-- Align the document types the app offers with the ones the database accepts.
--
-- Four lists of document types had grown up independently -- the upload
-- panel's, the edit dialog's, the Documents page's filter chips and the claim
-- packet's label map -- and none of them matched this constraint. Two edit
-- dialog options ('payment_confirmation', 'medical_record') and one upload
-- option ('prescription_label') were not accepted here at all, so choosing one
-- failed the write: at upload, after the file had already reached storage.
--
-- 'prescription_label' is the one of the three that belongs. It was in the
-- original constraint (20251017030518), the claim packet still names files
-- after it, and the audit checklist asks for one on prescription expenses; it
-- was dropped by accident when 20260816200000 rewrote this list for the
-- letter-of-medical-necessity gate. The other two were never real types and
-- are not being added -- an explanation of benefits is the payment
-- confirmation, and "medical record" has no meaning in a claim packet.
ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_document_type_check;
ALTER TABLE public.receipts ADD CONSTRAINT receipts_document_type_check
  CHECK (document_type IN (
    'receipt', 'invoice', 'bill', 'itemized_statement', 'eob',
    'payment_receipt', 'payment_plan_agreement', 'prescription_label',
    'letter_of_medical_necessity',
    'other'
  ));

-- Settle the two spellings of the same thing.
--
-- 'bill' and 'invoice' both mean a bill and both pass the constraint, but
-- manual expense entry and the inbound-email webhook wrote 'bill' while the
-- audit checklist and the Documents filter only ever looked for 'invoice'. A
-- bill typed by hand or emailed in therefore never counted as one. Both
-- writers now say 'invoice'; this settles the rows already stored.
--
-- 'bill' stays in the constraint above rather than being dropped. It costs
-- nothing, and dropping a value this statement is responsible for clearing
-- would turn any row it missed into a failed deploy.
UPDATE public.receipts
   SET document_type = 'invoice'
 WHERE document_type = 'bill';

COMMENT ON COLUMN public.receipts.document_type IS
  'What the document is. Must stay in step with DOCUMENT_TYPES in
   src/lib/documentTypes.ts, which is the list every picker renders: a value
   offered there and missing here fails the write after the file has already
   been stored. ''bill'' is the legacy spelling of ''invoice'' and is read but
   never written. ''letter_of_medical_necessity'' is not user-selectable --
   attaching one clears a conditionally eligible expense, and trg_receipts_lmn
   fires on INSERT and DELETE only.';
