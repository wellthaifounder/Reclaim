-- Migration: Add computed invoice_status column to invoices
-- Part of Phase 0 (Quick Wins) of the expense lifecycle redesign.
-- See: .specify/specs/expense-lifecycle-redesign/design-document.md

-- 1. Create enum type
CREATE TYPE invoice_status AS ENUM ('draft', 'unpaid', 'partially_paid', 'fully_paid', 'reimbursed');

-- 2. Add column with default
ALTER TABLE invoices ADD COLUMN status invoice_status NOT NULL DEFAULT 'unpaid';

-- 3. Create function to compute status from payment_transactions
CREATE OR REPLACE FUNCTION compute_invoice_status(p_invoice_id UUID)
RETURNS invoice_status AS $$
DECLARE
  v_total NUMERIC;
  v_paid NUMERIC;
  v_reimbursed BOOLEAN;
BEGIN
  SELECT COALESCE(total_amount, amount, 0) INTO v_total
  FROM invoices WHERE id = p_invoice_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payment_transactions WHERE invoice_id = p_invoice_id;

  SELECT EXISTS(
    SELECT 1 FROM payment_transactions
    WHERE invoice_id = p_invoice_id AND is_reimbursed = true
  ) INTO v_reimbursed;

  IF v_reimbursed THEN RETURN 'reimbursed'; END IF;
  IF v_paid >= v_total AND v_total > 0 THEN RETURN 'fully_paid'; END IF;
  IF v_paid > 0 THEN RETURN 'partially_paid'; END IF;
  RETURN 'unpaid';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. Create trigger function to keep status in sync
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE invoices SET status = compute_invoice_status(OLD.invoice_id)
    WHERE id = OLD.invoice_id;
    RETURN OLD;
  ELSE
    UPDATE invoices SET status = compute_invoice_status(NEW.invoice_id)
    WHERE id = NEW.invoice_id;
    -- If invoice_id changed on UPDATE, also recompute the old invoice's status
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
      UPDATE invoices SET status = compute_invoice_status(OLD.invoice_id)
      WHERE id = OLD.invoice_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. Create triggers on payment_transactions
CREATE TRIGGER trg_update_invoice_status_insert
  AFTER INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_invoice_status();

CREATE TRIGGER trg_update_invoice_status_update
  AFTER UPDATE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_invoice_status();

CREATE TRIGGER trg_update_invoice_status_delete
  AFTER DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_invoice_status();

-- 6. Backfill existing invoices
UPDATE invoices SET status = compute_invoice_status(id);

-- 7. Index for filtering by status
CREATE INDEX idx_invoices_status ON invoices(status);
