-- Phase 1 — Reclaim Foundation
-- Date: 2026-05-21
-- See: docs/PRODUCT_BRIEF.md (Reclaim v1, Phase 1)
--
-- Adds three primitives the new product loop needs:
--   1. invoice_lifecycle_status enum + invoices.lifecycle_status column
--      (eligibility journey: captured → pending_review → eligible/ineligible/
--       needs_receipt → submitted → reimbursed). Orthogonal to the existing
--      `status` column (payment axis: unpaid/partially_paid/fully_paid/...),
--      which remains trigger-driven from payment_transactions. The existing
--      update_invoice_status() trigger is intentionally left untouched
--      because it writes only to `status`; the two axes never collide.
--   2. invoices.patient_name TEXT — required for IRS Pub 502 compliant
--      Substantiation Records ("Self" / "Spouse" / dependent name).
--   3. profiles.reimbursement_strategy_preference TEXT — 'regular' or
--      'shoebox'. Gates notification + dashboard labeling behavior in
--      Phases 4/5.

-- ── 1. Lifecycle state machine ────────────────────────────────────────────
CREATE TYPE invoice_lifecycle_status AS ENUM (
  'captured',
  'pending_review',
  'eligible',
  'ineligible',
  'needs_receipt',
  'submitted',
  'reimbursed'
);

ALTER TABLE invoices
  ADD COLUMN lifecycle_status invoice_lifecycle_status NOT NULL DEFAULT 'captured';

COMMENT ON COLUMN invoices.lifecycle_status IS
  'Reclaim eligibility lifecycle (Phase 1). App-managed, orthogonal to `status` (payment axis). See docs/PRODUCT_BRIEF.md §6.';

CREATE INDEX idx_invoices_lifecycle_status ON invoices(lifecycle_status);

-- Backfill: preserve closed-loop state for previously reimbursed rows.
-- is_hsa_eligible is intentionally NOT mapped to 'eligible' because that
-- boolean is set by category-matching at upload time, not by explicit user
-- confirmation. Per the brief, explicit user confirmation is the audit-
-- trail event that earns the ELIGIBLE state.
--
-- Guarded with IF EXISTS because production may lag local — the legacy
-- `status` column (added by 20260412_add_invoice_status) is not present on
-- every environment. This matches the CLAUDE.md 2026-05-03 lesson: every
-- migration must be runnable from an empty schema; cross-migration column
-- references need a DO $$ IF EXISTS guard.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'status'
  ) THEN
    UPDATE invoices SET lifecycle_status = 'reimbursed' WHERE status = 'reimbursed';
  END IF;
END $$;

-- ── 2. Patient tagging ───────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN patient_name TEXT;

COMMENT ON COLUMN invoices.patient_name IS
  'Reclaim: per-expense patient tag for IRS Pub 502 Substantiation Records. Values: ''Self'', ''Spouse'', or free-text dependent name. Nullable for legacy rows.';

-- ── 3. HSA reimbursement strategy preference ─────────────────────────────
ALTER TABLE profiles
  ADD COLUMN reimbursement_strategy_preference TEXT
    NOT NULL
    DEFAULT 'regular'
    CHECK (reimbursement_strategy_preference IN ('regular', 'shoebox'));

COMMENT ON COLUMN profiles.reimbursement_strategy_preference IS
  'Reclaim: ''regular'' (monthly submission reminders enabled) or ''shoebox'' (defer reimbursement; suppress reminder; relabel ELIGIBLE bucket as ''Shoebox Balance''). Selector UI lands in Phase 6 onboarding rebuild.';
