-- Phase 2 W3 — Reclaim Capture: historical import + wow moment
-- Date: 2026-05-24
-- See: docs/PRODUCT_BRIEF.md §4 ("Historical Lookback") and §18 Phase 2 #7
--
-- Adds the data needed for the brand-defining activation event: pulling
-- 12–24 months of Plaid transactions immediately on first connection and
-- showing the user how many medical expenses we surfaced.
--
-- Two slices:
--   1. `plaid_connections` gets first-sync completion tracking + the counts
--      we display in the wow-moment screen.
--   2. `invoices` gets `source_plaid_transaction_id` with a partial UNIQUE
--      index. The webhook (Phase 2 W2) and the historical sync (this work)
--      both auto-capture invoices for medical Plaid transactions; without a
--      DB-level guard they can race and produce duplicates. The smoke-test
--      logs confirmed Plaid fires INITIAL_UPDATE + HISTORICAL_UPDATE
--      asynchronously after item creation — exactly when our own initial
--      sync is also running.

-- ── 1. plaid_connections: track first-sync state + counts ────────────────
ALTER TABLE plaid_connections
  ADD COLUMN first_sync_completed_at TIMESTAMPTZ,
  ADD COLUMN initial_medical_count   INTEGER,
  ADD COLUMN initial_total_count     INTEGER;

COMMENT ON COLUMN plaid_connections.first_sync_completed_at IS
  'Reclaim Phase 2 W3: timestamp when the initial 18-month historical pull finished. NULL while the connection has not yet completed its first sync.';
COMMENT ON COLUMN plaid_connections.initial_medical_count IS
  'Reclaim Phase 2 W3: count of medical-classified transactions found in the historical pull. Used to render the wow-moment screen ("We found N transactions...").';
COMMENT ON COLUMN plaid_connections.initial_total_count IS
  'Reclaim Phase 2 W3: total transactions ingested during the historical pull (medical + non-medical), useful for secondary copy and audit.';

-- ── 2. invoices.source_plaid_transaction_id: race-safe auto-capture ──────
ALTER TABLE invoices
  ADD COLUMN source_plaid_transaction_id TEXT;

COMMENT ON COLUMN invoices.source_plaid_transaction_id IS
  'Reclaim Phase 2 W3: Plaid transaction ID that auto-created this invoice (via plaid-sync-transactions or plaid-webhook). NULL for invoices created from the BillUploadWizard or manual entry. Partial UNIQUE index prevents duplicate auto-captures when the webhook races the initial historical sync.';

-- Partial UNIQUE: only enforce uniqueness on rows where the column is set.
-- Manually-entered invoices (NULL) don't participate.
CREATE UNIQUE INDEX idx_invoices_source_plaid_txn_unique
  ON invoices(source_plaid_transaction_id)
  WHERE source_plaid_transaction_id IS NOT NULL;
