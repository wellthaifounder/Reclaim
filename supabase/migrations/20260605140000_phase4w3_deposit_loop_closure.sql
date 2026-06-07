-- Phase 4 W3 — Reclaim deposit detection → REIMBURSED loop closure
-- Date: 2026-06-05
-- See: docs/PRODUCT_BRIEF.md §5 (core loop final step), §18 Phase 4 #14.
--
-- Closes the Reclaim core loop: when Plaid sees a deposit on the user's
-- connected account that matches the total of an open Substantiation
-- Record, we surface a confirm prompt; the user clicks Yes and the record
-- + every bundled invoice cascade to REIMBURSED.
--
-- Design:
--   - reimbursement_match_candidates is purpose-built rather than overloaded
--     onto inbox_items so the matching logic stays simple and the UI can
--     query candidates with a focused shape.
--   - The match algorithm itself lives in the Plaid edge functions (sync +
--     webhook). The DB just stores candidates and final state.
--   - Exact-amount matching with a $0.01 tolerance and a 90-day look-back
--     window from the record's generation. Outside that window deposits are
--     treated as unrelated (paycheck, transfer, etc.).

-- ── 1. reimbursement_match_candidates ────────────────────────────────────
CREATE TABLE reimbursement_match_candidates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id           UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  substantiation_record_id UUID NOT NULL REFERENCES substantiation_records(id) ON DELETE CASCADE,
  match_amount             NUMERIC(12,2) NOT NULL,
  match_confidence         NUMERIC(3,2) NOT NULL
    CHECK (match_confidence >= 0 AND match_confidence <= 1),
  match_reason             TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ,
  UNIQUE (transaction_id, substantiation_record_id)
);

COMMENT ON TABLE reimbursement_match_candidates IS
  'Reclaim Phase 4 W3: Plaid credits the matcher believes might close an open Substantiation Record. The user resolves each: confirmed → cascades REIMBURSED through the record + items; dismissed → recorded but ignored. The UNIQUE constraint prevents duplicate candidates if the same txn arrives via both sync and webhook.';
COMMENT ON COLUMN reimbursement_match_candidates.match_confidence IS
  '1.0 for exact-amount-within-tolerance + within 90 days of record generation. Lower values reserved for future fuzzy-match heuristics.';

CREATE INDEX idx_reimbursement_candidates_user_status
  ON reimbursement_match_candidates(user_id, status);
CREATE INDEX idx_reimbursement_candidates_record
  ON reimbursement_match_candidates(substantiation_record_id);

ALTER TABLE reimbursement_match_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reimbursement candidates"
  ON reimbursement_match_candidates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own reimbursement candidates"
  ON reimbursement_match_candidates FOR UPDATE
  USING (auth.uid() = user_id);

-- ── 2. substantiation_records: REIMBURSED close-out fields ───────────────
ALTER TABLE substantiation_records
  ADD COLUMN reimbursed_at             TIMESTAMPTZ,
  ADD COLUMN reimbursed_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN substantiation_records.reimbursed_at IS
  'Reclaim Phase 4 W3: timestamp when the user confirmed a Plaid-detected deposit closed this record. Pairs with status=''reimbursed''.';
COMMENT ON COLUMN substantiation_records.reimbursed_transaction_id IS
  'Reclaim Phase 4 W3: the Plaid transaction (the deposit) the user attributed to closing this record. Useful for audit trail and Substantiation Record amendments.';

-- ── 3. invoices: REIMBURSED timestamp ────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN reimbursed_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.reimbursed_at IS
  'Reclaim Phase 4 W3: timestamp when this invoice''s submitted_record_id was closed via deposit confirmation. lifecycle_status transitions SUBMITTED → REIMBURSED at the same moment.';

CREATE INDEX idx_invoices_reimbursed_at
  ON invoices(reimbursed_at)
  WHERE reimbursed_at IS NOT NULL;
