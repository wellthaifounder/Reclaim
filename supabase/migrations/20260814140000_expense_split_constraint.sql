-- Bank-Sync Rebuild — Workstream B3: expense splitting constraint
-- Date: 2026-08-14
-- See: .claude/plans/bank-sync-workflow-spec.md ("Splitting")
--
-- 20260814120000 added invoices.source_transaction_id so one bank transaction
-- can yield several expenses. This enforces the one rule that makes that safe:
-- the expenses derived from a transaction may not claim more money than the
-- transaction actually moved.
--
-- Two real cases motivate splitting, and they need DIFFERENT totals:
--
--   Mixed basket    $87 at Walmart -> a $12 Tylenol expense. The remaining $75
--                   is groceries and never becomes an expense at all. So the
--                   rule is sum <= transaction amount, NOT equality.
--   Bundled payment $2,400 to a hospital -> three expenses across two family
--                   members and two tax years, together totalling $2,400.
--
-- Note this is deliberately not the same shape as `transaction_splits`, which
-- splits a transaction across HSA *accounts* for allocation purposes. That
-- table answers "which account paid for this"; this answers "what expenses did
-- this payment represent". Conflating them is what made the old split UI
-- unable to express the Walmart case.
--
-- A CHECK constraint cannot express this: it aggregates across sibling rows.
-- Hence a trigger.

CREATE OR REPLACE FUNCTION public.enforce_expense_split_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  txn_amount NUMERIC;
  allocated  NUMERIC;
  proposed   NUMERIC;
BEGIN
  IF NEW.source_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE serializes concurrent splits of the same transaction. Without
  -- it two simultaneous inserts could each read a stale total and both pass,
  -- together over-allocating the transaction.
  SELECT t.amount INTO txn_amount
    FROM transactions t
   WHERE t.id = NEW.source_transaction_id
   FOR UPDATE;

  -- Transaction gone or amount unknown: nothing to enforce against.
  IF txn_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(i.amount_paid), 0) INTO allocated
    FROM invoices i
   WHERE i.source_transaction_id = NEW.source_transaction_id
     AND i.id <> NEW.id;

  proposed := allocated + COALESCE(NEW.amount_paid, 0);

  -- Half-cent tolerance absorbs binary rounding when a user splits an odd
  -- amount evenly; it is far below anything a user could enter.
  IF proposed > txn_amount + 0.005 THEN
    RAISE EXCEPTION
      'Expense splits for this transaction total %, which exceeds the transaction amount of %',
      ROUND(proposed, 2), ROUND(txn_amount, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_invoices_enforce_split_total
  BEFORE INSERT OR UPDATE OF amount_paid, source_transaction_id
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_split_total();

COMMENT ON FUNCTION public.enforce_expense_split_total() IS
  'Workstream B3: expenses derived from one bank transaction may not together claim more than the transaction moved. Enforces sum <= amount (not equality) so a mixed basket can leave a non-medical remainder unclaimed.';
