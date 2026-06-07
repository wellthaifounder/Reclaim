-- Phase 4 W1+W2 — Reclaim Substantiation Record + SUBMITTED state
-- Date: 2026-06-05
-- See: docs/PRODUCT_BRIEF.md §6 (state machine), §7 (Substantiation Record).
--
-- The Substantiation Record is the product's most valuable and defensible
-- output (brief §7). Each record snapshots the user-confirmed eligibility
-- of a bundle of expenses at a moment in time. Snapshots matter: an invoice
-- may be edited later but a generated record cites the values that existed
-- when the user signed off — that's what the IRS would actually rely on
-- in an audit.
--
-- Slices:
--   1. `substantiation_records` — one row per generated record.
--   2. `substantiation_record_items` — join, with VALUE SNAPSHOTS so the
--      record stays valid even if the underlying invoice is edited later.
--   3. `invoices.submitted_at` + `submitted_record_id` — back-link from
--      invoice to its first record, drives the SUBMITTED lifecycle state.

-- ── 1. substantiation_records ────────────────────────────────────────────
CREATE TABLE substantiation_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record_number     TEXT NOT NULL,
  tax_year          INTEGER NOT NULL,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_amount      NUMERIC(12,2) NOT NULL,
  expense_count     INTEGER NOT NULL,
  formats_generated TEXT[] NOT NULL DEFAULT '{}',
  pdf_storage_path  TEXT,
  csv_storage_path  TEXT,
  status            TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'reimbursed', 'voided')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, record_number)
);

COMMENT ON TABLE substantiation_records IS
  'Reclaim Phase 4: one row per generated IRS Substantiation Record. Used to track what was bundled, what format(s) were produced, and the eventual REIMBURSED close from Plaid deposit detection (Phase 4 W3).';
COMMENT ON COLUMN substantiation_records.record_number IS
  'Human-readable identifier: RCM-{tax_year}-{0001-padded seq}. Per-user, per-year sequence.';
COMMENT ON COLUMN substantiation_records.formats_generated IS
  'Array of formats that were generated: e.g. ARRAY[''irs_pdf'',''csv''].';
COMMENT ON COLUMN substantiation_records.status IS
  '"generated" (just created, awaiting HSA distribution), "reimbursed" (Plaid detected matching deposit + user confirmed close — Phase 4 W3), "voided" (user generated then discarded).';

CREATE INDEX idx_substantiation_records_user_year
  ON substantiation_records(user_id, tax_year);
CREATE INDEX idx_substantiation_records_status
  ON substantiation_records(user_id, status);

ALTER TABLE substantiation_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own substantiation records"
  ON substantiation_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own substantiation records"
  ON substantiation_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own substantiation records"
  ON substantiation_records FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own substantiation records"
  ON substantiation_records FOR DELETE
  USING (auth.uid() = user_id);

-- ── 2. substantiation_record_items ───────────────────────────────────────
-- Snapshot columns. The brief §7 calls out the user's confirmation
-- timestamp as the moat: we copy it onto the join row so the audit trail
-- survives even if invoices.confirmed_at is mutated later.
CREATE TABLE substantiation_record_items (
  id                                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  substantiation_record_id                 UUID NOT NULL REFERENCES substantiation_records(id) ON DELETE CASCADE,
  invoice_id                               UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_at_submission                     NUMERIC(12,2) NOT NULL,
  vendor_at_submission                     TEXT NOT NULL,
  date_at_submission                       DATE NOT NULL,
  patient_name_at_submission               TEXT,
  category_at_submission                   TEXT,
  eligibility_basis_rule_id_at_submission  TEXT REFERENCES pub_502_rules(id),
  confirmed_at_at_submission               TIMESTAMPTZ NOT NULL,
  created_at                               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (substantiation_record_id, invoice_id)
);

COMMENT ON TABLE substantiation_record_items IS
  'Reclaim Phase 4: snapshot of each invoice as it appeared when the user generated the substantiation record. Snapshot columns mean the record stays audit-defensible even if the underlying invoice is later edited.';
COMMENT ON COLUMN substantiation_record_items.confirmed_at_at_submission IS
  'Snapshotted from invoices.confirmed_at at record-generation time. This is the audit-trail moat per brief §7.';

CREATE INDEX idx_substantiation_record_items_record
  ON substantiation_record_items(substantiation_record_id);
CREATE INDEX idx_substantiation_record_items_invoice
  ON substantiation_record_items(invoice_id);

ALTER TABLE substantiation_record_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own substantiation record items"
  ON substantiation_record_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM substantiation_records sr
    WHERE sr.id = substantiation_record_items.substantiation_record_id
      AND sr.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert items into their own substantiation records"
  ON substantiation_record_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM substantiation_records sr
    WHERE sr.id = substantiation_record_items.substantiation_record_id
      AND sr.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete items from their own substantiation records"
  ON substantiation_record_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM substantiation_records sr
    WHERE sr.id = substantiation_record_items.substantiation_record_id
      AND sr.user_id = auth.uid()
  ));

-- ── 3. invoices SUBMITTED-state link ─────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN submitted_at        TIMESTAMPTZ,
  ADD COLUMN submitted_record_id UUID REFERENCES substantiation_records(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.submitted_at IS
  'Reclaim Phase 4: timestamp when this invoice was first included in a Substantiation Record. NULL until the user generates a record that includes it.';
COMMENT ON COLUMN invoices.submitted_record_id IS
  'Reclaim Phase 4: the first record this invoice was bundled into. On record deletion, set NULL — the invoice rolls back to ELIGIBLE so the user can re-submit. Subsequent records can reference the same invoice via substantiation_record_items but only the first sets this back-link.';

CREATE INDEX idx_invoices_submitted_record ON invoices(submitted_record_id)
  WHERE submitted_record_id IS NOT NULL;
