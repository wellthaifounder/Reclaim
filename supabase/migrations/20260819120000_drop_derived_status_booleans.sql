-- Retire invoices.is_hsa_eligible and invoices.is_reimbursed.
--
-- 20260814120000 replaced these two writable columns with generated ones
-- derived from the facets, and left a note: "Retained so existing readers keep
-- working; drop once none reference it." Every reader has now been migrated
-- (workstream F2), so they come out.
--
-- Dropping them is not only cleanup. `is_reimbursed` was true only for
-- claim_state 'reimbursed'/'reimbursed_externally', so every caller that wrote
-- `is_hsa_eligible AND NOT is_reimbursed` to mean "still claimable" also swept
-- in 'not_reimbursable' (already paid with the HSA card) and
-- 'locked_in_request' (already committed to an open request). That overstated
-- claimable money everywhere it was used, and in two places fed those
-- expenses into a new claim. Removing the columns makes that mistake
-- impossible to write again.
--
-- Order matters: ledger_entries selects both columns, and
-- update_collection_totals reads is_hsa_eligible, so both must stop referring
-- to them before the ALTER can run.

-- ── 1. The care-event totals trigger ──────────────────────────────────────
-- Same function, with the eligibility test expressed against the facet. The
-- trigger already fires on UPDATE OF eligibility_state (rekeyed in
-- 20260814120000); only the body still reached for the derived column.
CREATE OR REPLACE FUNCTION public.update_collection_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.collection_id IS NOT NULL THEN
    UPDATE collections
    SET
      total_billed = COALESCE((
        SELECT SUM(COALESCE(total_amount, amount))
        FROM invoices
        WHERE collection_id = NEW.collection_id
      ), 0),
      hsa_eligible_amount = COALESCE((
        SELECT SUM(COALESCE(total_amount, amount))
        FROM invoices
        WHERE collection_id = NEW.collection_id
          AND eligibility_state = 'eligible'
      ), 0),
      updated_at = NOW()
    WHERE id = NEW.collection_id;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.collection_id IS NOT NULL
     AND OLD.collection_id IS DISTINCT FROM NEW.collection_id THEN
    UPDATE collections
    SET
      total_billed = COALESCE((
        SELECT SUM(COALESCE(total_amount, amount))
        FROM invoices
        WHERE collection_id = OLD.collection_id
      ), 0),
      hsa_eligible_amount = COALESCE((
        SELECT SUM(COALESCE(total_amount, amount))
        FROM invoices
        WHERE collection_id = OLD.collection_id
          AND eligibility_state = 'eligible'
      ), 0),
      updated_at = NOW()
    WHERE id = OLD.collection_id;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── 2. Drop the view, then the columns ────────────────────────────────────
DROP VIEW IF EXISTS ledger_entries;

ALTER TABLE invoices DROP COLUMN IF EXISTS is_hsa_eligible;
ALTER TABLE invoices DROP COLUMN IF EXISTS is_reimbursed;

-- ── 3. Recreate the view without them ─────────────────────────────────────
-- Byte-for-byte the definition 20260814120000/20260815190000 produced, minus
-- i.is_hsa_eligible and i.is_reimbursed. The three facets stay: the Ledger
-- page reads eligibility_state and claim_state directly now.
CREATE VIEW ledger_entries AS
SELECT
  i.id AS invoice_id,
  i.user_id,
  i.vendor,
  i.category,
  i.date AS service_date,
  i.invoice_date,
  i.amount AS billed_amount,
  i.total_amount,
  i.documentation_state,
  i.eligibility_state,
  i.claim_state,
  i.amount_paid,
  i.reimbursable_amount,
  i.reimbursed_amount,
  i.status AS invoice_status,
  i.collection_id,
  i.invoice_number,
  i.notes AS invoice_notes,
  i.created_at AS invoice_created_at,
  COALESCE(pay.total_paid, 0::numeric) AS total_paid,
  COALESCE(pay.paid_via_hsa, 0::numeric) AS paid_via_hsa,
  COALESCE(pay.paid_via_oop, 0::numeric) AS paid_via_oop,
  COALESCE(i.amount, 0::numeric) - COALESCE(pay.total_paid, 0::numeric)
    AS outstanding_balance,
  COALESCE(pay.payment_count, 0::bigint) AS payment_count,
  COALESCE(pay.has_auto_linked, false) AS has_auto_linked,
  pay.latest_payment_date,
  COALESCE(txn.linked_transaction_count, 0::bigint) AS linked_transaction_count,
  CASE
    WHEN COALESCE(pay.payment_count, 0::bigint) = 0 THEN 'unmatched'::text
    WHEN COALESCE(pay.has_auto_linked, false) THEN 'auto_matched'::text
    ELSE 'manual'::text
  END AS match_status,
  c.title AS care_event_title
FROM invoices i
  LEFT JOIN LATERAL (
    SELECT
      sum(pt.amount) AS total_paid,
      sum(CASE WHEN pt.payment_source = 'hsa_direct'::text
               THEN pt.amount ELSE 0::numeric END) AS paid_via_hsa,
      sum(CASE WHEN pt.payment_source = 'out_of_pocket'::text
               THEN pt.amount ELSE 0::numeric END) AS paid_via_oop,
      count(*) AS payment_count,
      bool_or(pt.auto_linked) AS has_auto_linked,
      max(pt.payment_date) AS latest_payment_date
    FROM payment_transactions pt
    WHERE pt.invoice_id = i.id
  ) pay ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS linked_transaction_count
    FROM transactions t
    WHERE t.invoice_id = i.id
  ) txn ON true
  LEFT JOIN collections c ON c.id = i.collection_id
WHERE NOT (EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id = i.source_transaction_id AND t.is_transfer
));
