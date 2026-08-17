-- Workstream E1 — retire the legacy reimbursement path.
--
-- Two subsystems have been writing reimbursement history side by side.
-- `reimbursement_requests` / `reimbursement_items` is the older one, reached
-- from three pages and a dialog; `substantiation_records` /
-- `substantiation_record_items` is the canonical one the spec describes. The
-- spec's instruction is unambiguous -- "aggressive removal, one canonical
-- path" -- and there is a concrete reason beyond tidiness:
--
--   The legacy path marked every included expense claim_state = 'reimbursed'
--   at the moment the PDF was downloaded. Not submitted -- reimbursed. The
--   money had not moved, the custodian had not seen the claim, and it might
--   yet be rejected, but the expense was already recorded as paid back and
--   removed from every claimable total the user sees. The canonical path sets
--   'locked_in_request' at that moment and only advances to 'reimbursed' when
--   a matching deposit is confirmed.
--
-- So the old rows are real history and must survive; the old tables must not.
--
-- MIGRATION, NOT DELETION. Every legacy request becomes a substantiation
-- record, keeping its own id so the correspondence stays inspectable, and
-- every item becomes a snapshot row. The legacy table stored no snapshot at
-- all -- just a pointer to the invoice -- so the snapshot is taken from the
-- invoice as it stands today. That is the best information that exists; the
-- alternative is discarding the record entirely.
--
-- Claim state is left exactly as it is. Those expenses were marked reimbursed
-- by the old flow, possibly wrongly, but rewriting a user's settled financial
-- history on the strength of an inference is worse than leaving it. New
-- claims go through the correct path from here.

-- ── 1. Requests become substantiation records ─────────────────────────────

INSERT INTO public.substantiation_records
  (id, user_id, record_number, tax_year, generated_at, total_amount,
   expense_count, formats_generated, status, notes, created_at, updated_at,
   reimbursed_at)
SELECT
  n.req_id,
  n.user_id,
  'RCM-' || n.tax_year || '-' || LPAD(n.seq::TEXT, 4, '0'),
  n.tax_year,
  n.at,
  n.total_amount,
  n.expense_count,
  -- The legacy flow always produced a PDF and never a CSV.
  ARRAY['pdf']::TEXT[],
  n.new_status,
  n.notes,
  n.created_at,
  now(),
  CASE WHEN n.new_status = 'reimbursed' THEN n.at ELSE NULL END
FROM (
  SELECT
    y.*,
    -- Numbered per user and tax year, continuing above whatever the canonical
    -- table already holds so the two histories interleave without collision.
    ROW_NUMBER() OVER (
      PARTITION BY y.user_id, y.tax_year ORDER BY y.at, y.req_id
    )
    + COALESCE((
        SELECT MAX(NULLIF(SUBSTRING(sr.record_number FROM '(\d+)$'), '')::INT)
          FROM public.substantiation_records sr
         WHERE sr.user_id = y.user_id AND sr.tax_year = y.tax_year
      ), 0) AS seq
  FROM (
    SELECT
      rr.id       AS req_id,
      rr.user_id,
      rr.total_amount,
      rr.notes,
      rr.created_at,
      COALESCE(rr.submitted_at, rr.created_at) AS at,
      -- Legacy statuses were pending / submitted / approved / paid / rejected.
      CASE
        WHEN rr.status = 'paid'     THEN 'reimbursed'
        WHEN rr.status = 'rejected' THEN 'voided'
        ELSE 'generated'
      END AS new_status,
      -- The IRS ties an expense to its date of service, so the tax year comes
      -- from the care, not from when the request happened to be created.
      COALESCE(
        (SELECT EXTRACT(YEAR FROM MAX(i.effective_service_date))::INT
           FROM public.reimbursement_items ri
           JOIN public.invoices i ON i.id = ri.invoice_id
          WHERE ri.reimbursement_request_id = rr.id),
        EXTRACT(YEAR FROM COALESCE(rr.submitted_at, rr.created_at))::INT
      ) AS tax_year,
      (SELECT COUNT(DISTINCT ri.invoice_id)
         FROM public.reimbursement_items ri
        WHERE ri.reimbursement_request_id = rr.id)::INT AS expense_count
    FROM public.reimbursement_requests rr
    -- Paranoia only: the two id spaces are independent gen_random_uuid()
    -- draws. If one ever collided, skipping is safer than overwriting.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.substantiation_records sr WHERE sr.id = rr.id
    )
  ) y
) n;

-- ── 2. Items become snapshots ─────────────────────────────────────────────

INSERT INTO public.substantiation_record_items
  (substantiation_record_id, invoice_id, amount_at_submission,
   vendor_at_submission, date_at_submission, patient_name_at_submission,
   category_at_submission, eligibility_basis_rule_id_at_submission,
   confirmed_at_at_submission, created_at)
SELECT DISTINCT ON (ri.reimbursement_request_id, ri.invoice_id)
  ri.reimbursement_request_id,
  ri.invoice_id,
  COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
  i.vendor,
  i.effective_service_date,
  i.patient_name,
  i.category,
  i.eligibility_basis_rule_id,
  -- The column is NOT NULL because a canonical record cannot exist without a
  -- user confirmation. The legacy flow never captured one, so the request's
  -- own timestamp stands in: it is the moment the user chose to claim, which
  -- is the closest thing the old data has to a confirmation.
  COALESCE(i.confirmed_at, sr.generated_at),
  sr.generated_at
FROM public.reimbursement_items ri
JOIN public.substantiation_records sr ON sr.id = ri.reimbursement_request_id
JOIN public.invoices i ON i.id = ri.invoice_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.substantiation_record_items x
   WHERE x.substantiation_record_id = ri.reimbursement_request_id
     AND x.invoice_id = ri.invoice_id
);

-- Back-link the expenses that have none, so the migrated record is reachable
-- from the expense as well as the other way round. First record wins, matching
-- the canonical path's own rule.
UPDATE public.invoices i
   SET submitted_record_id = sri.substantiation_record_id
  FROM public.substantiation_record_items sri
  JOIN public.reimbursement_items ri
    ON ri.reimbursement_request_id = sri.substantiation_record_id
   AND ri.invoice_id = sri.invoice_id
 WHERE i.id = sri.invoice_id
   AND i.submitted_record_id IS NULL;

-- ── 3. Drop the legacy path ───────────────────────────────────────────────

-- payment_transactions pointed at the old request. Nothing reads it -- the
-- canonical link is invoices.submitted_record_id -- and leaving a dangling
-- column named after a dropped table is how the next person rebuilds it.
ALTER TABLE public.payment_transactions
  DROP COLUMN IF EXISTS reimbursement_request_id;

DROP TABLE IF EXISTS public.reimbursement_items;
DROP TABLE IF EXISTS public.reimbursement_requests;
