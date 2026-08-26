-- Bank-Sync Rebuild — Workstream B: expense facets, money model, transaction link
-- Date: 2026-08-14
-- See: .claude/plans/bank-sync-workflow-spec.md ("Object model")
--      .claude/plans/bank-sync-implementation-plan.md §B1, §B2, §B4, §B5
--
-- The central defect this fixes: `invoices` carries FOUR overlapping
-- representations of state --
--
--   status            (invoice_status enum)           trigger-driven, payment axis
--   lifecycle_status  (invoice_lifecycle_status enum)  app-managed, eligibility axis
--   is_reimbursed     (boolean)                        legacy
--   is_hsa_eligible   (boolean)                        legacy
--
-- Both enums contain 'reimbursed', and the two reimbursement subsystems write
-- to different ones: /hsa-reimbursement sets is_reimbursed while /substantiation
-- sets lifecycle_status. A user who reimburses via the former still shows as
-- claimable on the dashboard. That is a live, user-visible contradiction.
--
-- The fix is one source of truth: three ORTHOGONAL facets. They are orthogonal
-- precisely so they cannot contradict each other the way two overlapping
-- enums do -- a thing's documentation, its eligibility, and its claim status
-- are genuinely independent properties.
--
--   documentation_state  none | partial | complete
--   eligibility_state    unknown | eligible | conditional | ineligible
--   claim_state          unclaimed | locked_in_request | reimbursed
--                        | reimbursed_externally | not_reimbursable
--
-- Everything else becomes DERIVED, never independently written:
--   is_hsa_eligible   -> GENERATED from eligibility_state
--   is_reimbursed     -> GENERATED from claim_state
--   lifecycle_status  -> maintained by a BEFORE trigger from all three facets
--
-- Deriving rather than dropping is deliberate. ~25 frontend files READ these
-- columns while only ~15 sites WRITE them. Generating them keeps every reader
-- working untouched while making divergence structurally impossible, and lets
-- the readers migrate incrementally instead of in one high-risk sweep. The
-- columns are removed once no reader references them.

-- ── 1. Facet enums ────────────────────────────────────────────────────────
CREATE TYPE expense_documentation_state AS ENUM ('none', 'partial', 'complete');

CREATE TYPE expense_eligibility_state AS ENUM (
  'unknown',      -- not yet assessed; the default until substantiation runs
  'eligible',
  'conditional',  -- qualifies only with a letter of medical necessity
  'ineligible'
);

CREATE TYPE expense_claim_state AS ENUM (
  'unclaimed',
  'locked_in_request',      -- committed to a non-voided substantiation record
  'reimbursed',
  'reimbursed_externally',  -- user reimbursed outside Reclaim
  'not_reimbursable'        -- paid with the HSA card: substantiate, never claim
);

-- ── 2. Facet columns ──────────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN documentation_state expense_documentation_state NOT NULL DEFAULT 'none',
  ADD COLUMN eligibility_state   expense_eligibility_state   NOT NULL DEFAULT 'unknown',
  ADD COLUMN claim_state         expense_claim_state         NOT NULL DEFAULT 'unclaimed',
  ADD COLUMN ineligible_reason   TEXT;

COMMENT ON COLUMN invoices.eligibility_state IS
  'Resolved at substantiation, not at capture -- it depends on date of service, patient and Pub 502 category, none of which are known when a bank transaction arrives.';
COMMENT ON COLUMN invoices.ineligible_reason IS
  'Why the expense failed an eligibility gate, e.g. pre_establishment, not_tax_dependent, not_qualified. Surfaced to the user; never silently discarded.';
COMMENT ON COLUMN invoices.claim_state IS
  'not_reimbursable is the HSA-card case: the distribution already happened, so it still requires substantiation but can never enter a reimbursement request.';

-- ── 3. Money model ────────────────────────────────────────────────────────
-- Supports partial reimbursement without a payment ledger: the reimbursable
-- amount defaults to what was paid and the user can lower it (an insurance
-- refund arriving later), and one transaction can split into several expenses.
ALTER TABLE invoices
  ADD COLUMN amount_paid         NUMERIC,
  ADD COLUMN reimbursable_amount NUMERIC,
  ADD COLUMN reimbursed_amount   NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN invoices.amount_paid IS
  'What the user actually paid out of pocket. Distinct from `amount` (billed) -- only the paid figure is reimbursable.';
COMMENT ON COLUMN invoices.reimbursable_amount IS
  'Defaults to amount_paid, editable downward. remaining = reimbursable_amount - reimbursed_amount is what the double-claim lock guards.';

-- ── 4. Transaction linkage (many expenses per transaction) ───────────────
-- One payment can cover several visits, family members, or tax years, and a
-- mixed basket (groceries plus Tylenol) is partly medical. `invoices` was
-- created 1:1 from a transaction via source_plaid_transaction_id, which cannot
-- express either case.
ALTER TABLE invoices
  ADD COLUMN source_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_source_transaction
  ON invoices(source_transaction_id)
  WHERE source_transaction_id IS NOT NULL;

COMMENT ON COLUMN invoices.source_transaction_id IS
  'Bank transaction this expense was derived from. Many expenses may share one transaction; sum of their amount_paid may not exceed the transaction amount.';

-- ── 5. Backfill facets from the four legacy representations ──────────────
UPDATE invoices i
SET
  documentation_state = CASE
    WHEN EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id) THEN 'complete'
    ELSE 'none'
  END::expense_documentation_state,

  eligibility_state = CASE
    WHEN i.lifecycle_status = 'ineligible' THEN 'ineligible'
    WHEN i.lifecycle_status IN ('eligible', 'submitted', 'reimbursed') THEN 'eligible'
    -- is_hsa_eligible was set by category matching at upload, not by explicit
    -- user confirmation, so it is NOT promoted to 'eligible'. Per the brief,
    -- confirmation is the audit-trail event that earns that state.
    ELSE 'unknown'
  END::expense_eligibility_state,

  claim_state = CASE
    WHEN i.lifecycle_status = 'reimbursed' OR i.is_reimbursed THEN 'reimbursed'
    WHEN i.lifecycle_status = 'submitted' THEN 'locked_in_request'
    ELSE 'unclaimed'
  END::expense_claim_state,

  amount_paid = COALESCE(i.user_responsibility_amount, i.amount),
  reimbursable_amount = COALESCE(i.user_responsibility_amount, i.amount),
  reimbursed_amount = CASE
    WHEN i.lifecycle_status = 'reimbursed' OR i.is_reimbursed
      THEN COALESCE(i.user_responsibility_amount, i.amount, 0)
    ELSE 0
  END;

-- ── 6. Derive the legacy booleans ─────────────────────────────────────────
-- ledger_entries selects both columns, so the view must be dropped before they
-- can be replaced and recreated afterwards.
DROP VIEW IF EXISTS ledger_entries;

-- trigger_update_collection_totals (20260131) lists is_hsa_eligible in its
-- UPDATE OF clause, which is a hard dependency on the column. Drop it here and
-- recreate it below keyed on eligibility_state -- the facet that now drives the
-- value. Leaving it on the generated column would be worse than useless: a
-- generated column can never be the target of an UPDATE, so the trigger would
-- silently stop firing and collection totals would drift.
DROP TRIGGER IF EXISTS trigger_update_collection_totals ON invoices;

ALTER TABLE invoices DROP COLUMN is_hsa_eligible;
ALTER TABLE invoices DROP COLUMN is_reimbursed;

ALTER TABLE invoices
  ADD COLUMN is_hsa_eligible BOOLEAN
    GENERATED ALWAYS AS (eligibility_state = 'eligible') STORED,
  ADD COLUMN is_reimbursed BOOLEAN
    GENERATED ALWAYS AS (
      claim_state IN ('reimbursed', 'reimbursed_externally')
    ) STORED;

COMMENT ON COLUMN invoices.is_hsa_eligible IS
  'DERIVED from eligibility_state. Read-only -- writes now raise an error. Retained so existing readers keep working; drop once none reference it.';
COMMENT ON COLUMN invoices.is_reimbursed IS
  'DERIVED from claim_state. Read-only. Deliberately excludes not_reimbursable (HSA-card spend was never reimbursed, so counting it would corrupt reimbursement totals); lifecycle_status keeps those out of claim lists instead.';

-- ── 7. lifecycle_status becomes derived ──────────────────────────────────
-- A trigger rather than a generated column: the mapping is a CASE producing an
-- enum, and generated columns require a provably immutable expression.
CREATE OR REPLACE FUNCTION public.sync_invoice_lifecycle_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.lifecycle_status := (CASE
    -- HSA-card spend maps to 'reimbursed' so legacy surfaces treat it as
    -- settled and never offer it for claiming. The money already left the HSA.
    WHEN NEW.claim_state IN ('reimbursed', 'reimbursed_externally', 'not_reimbursable')
      THEN 'reimbursed'
    WHEN NEW.claim_state = 'locked_in_request'          THEN 'submitted'
    WHEN NEW.eligibility_state = 'ineligible'           THEN 'ineligible'
    WHEN NEW.eligibility_state = 'conditional'          THEN 'needs_receipt'
    WHEN NEW.eligibility_state = 'eligible'
         AND NEW.documentation_state = 'none'           THEN 'needs_receipt'
    WHEN NEW.eligibility_state = 'eligible'             THEN 'eligible'
    WHEN NEW.documentation_state <> 'none'              THEN 'pending_review'
    ELSE 'captured'
  END)::invoice_lifecycle_status;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_invoices_sync_lifecycle
  BEFORE INSERT OR UPDATE OF documentation_state, eligibility_state, claim_state
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_lifecycle_status();

COMMENT ON COLUMN invoices.lifecycle_status IS
  'DERIVED from the three facets by trg_invoices_sync_lifecycle. Direct writes are overwritten -- set the facets instead.';

-- Re-derive for every existing row so the column agrees with the facets.
UPDATE invoices SET claim_state = claim_state;

-- Recreate the collection-totals trigger, now keyed on eligibility_state.
CREATE TRIGGER trigger_update_collection_totals
  AFTER INSERT OR UPDATE OF collection_id, amount, total_amount, eligibility_state
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_collection_totals();

-- ── 8. Recreate ledger_entries ────────────────────────────────────────────
-- Identical to 20260413_create_ledger_view.sql plus the three facets, so the
-- Ledger page can migrate off the derived booleans when convenient.
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
  i.is_hsa_eligible,
  i.is_reimbursed,
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
  COALESCE(pay.total_paid, 0) AS total_paid,
  COALESCE(pay.paid_via_hsa, 0) AS paid_via_hsa,
  COALESCE(pay.paid_via_oop, 0) AS paid_via_oop,
  COALESCE(i.amount, 0) - COALESCE(pay.total_paid, 0) AS outstanding_balance,
  COALESCE(pay.payment_count, 0) AS payment_count,
  COALESCE(pay.has_auto_linked, false) AS has_auto_linked,
  pay.latest_payment_date,
  COALESCE(txn.linked_transaction_count, 0) AS linked_transaction_count,
  CASE
    WHEN COALESCE(pay.payment_count, 0) = 0 THEN 'unmatched'
    WHEN COALESCE(pay.has_auto_linked, false) THEN 'auto_matched'
    ELSE 'manual'
  END AS match_status,
  c.title AS care_event_title
FROM invoices i
LEFT JOIN LATERAL (
  SELECT
    SUM(pt.amount) AS total_paid,
    SUM(CASE WHEN pt.payment_source = 'hsa_direct' THEN pt.amount ELSE 0 END) AS paid_via_hsa,
    SUM(CASE WHEN pt.payment_source = 'out_of_pocket' THEN pt.amount ELSE 0 END) AS paid_via_oop,
    COUNT(*) AS payment_count,
    bool_or(pt.auto_linked) AS has_auto_linked,
    MAX(pt.payment_date) AS latest_payment_date
  FROM payment_transactions pt
  WHERE pt.invoice_id = i.id
) pay ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS linked_transaction_count
  FROM transactions t
  WHERE t.invoice_id = i.id
) txn ON true
LEFT JOIN collections c ON c.id = i.collection_id;

COMMENT ON VIEW ledger_entries IS 'Unified view of invoices with payment aggregates, match status, care event info, and the Workstream B expense facets.';

-- ── 9. Indexes ────────────────────────────────────────────────────────────
CREATE INDEX idx_invoices_claim_state       ON invoices(user_id, claim_state);
CREATE INDEX idx_invoices_eligibility_state ON invoices(user_id, eligibility_state);
