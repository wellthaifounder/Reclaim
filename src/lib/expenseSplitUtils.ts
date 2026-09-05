/**
 * Splitting a bank transaction into expenses.
 *
 * Deliberately separate from `transactionSplitUtils.ts`, which splits a
 * transaction across HSA *accounts* for allocation. That answers "which
 * account paid for this"; this answers "what expenses did this payment
 * represent" — and the two have different rules.
 *
 * The key difference: HSA-account splits must sum EXACTLY to the transaction,
 * because every dollar came from some account. Expense splits must sum to at
 * most the transaction, because part of a payment is often not an expense at
 * all — the $75 of groceries in an $87 Walmart run never becomes anything.
 * Mirrors the DB trigger in 20260814140000_expense_split_constraint.sql.
 */

import { formatCurrency } from "@/lib/utils";

export interface ExpenseSplitDraft {
  /** What was paid for this portion. */
  amount: number;
  vendor: string;
  category: string;
  /** Date of service. The IRS ties an expense to when care was provided, not
   *  when it was paid, so this can differ from the transaction date. */
  serviceDate: string;
  patientName: string;
  notes: string;
}

export interface SplitValidation {
  isValid: boolean;
  /** Amount of the transaction not claimed by any expense. Not an error. */
  remainder: number;
  allocated: number;
  message?: string;
}

const TOLERANCE = 0.005;

export function validateExpenseSplits(
  splits: ExpenseSplitDraft[],
  transactionAmount: number,
): SplitValidation {
  const allocated = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const remainder = Math.max(0, transactionAmount - allocated);

  if (splits.length === 0) {
    return {
      isValid: false,
      allocated,
      remainder,
      message: "Add at least one expense.",
    };
  }

  if (splits.some((s) => !(Number(s.amount) > 0))) {
    return {
      isValid: false,
      allocated,
      remainder,
      message: "Every expense needs an amount greater than zero.",
    };
  }

  if (allocated > transactionAmount + TOLERANCE) {
    return {
      isValid: false,
      allocated,
      remainder: 0,
      message: `These expenses total ${formatUsd(allocated)}, which is more than the ${formatUsd(transactionAmount)} transaction.`,
    };
  }

  if (splits.some((s) => !s.vendor.trim())) {
    return {
      isValid: false,
      allocated,
      remainder,
      message: "Every expense needs a provider name.",
    };
  }

  return { isValid: true, allocated, remainder };
}

/**
 * Split evenly, pushing any rounding difference onto the first row so the parts
 * always re-sum to the total rather than losing a cent.
 */
export function splitEvenly(total: number, parts: number): number[] {
  if (parts < 1) return [];
  const each = Math.floor((total * 100) / parts) / 100;
  const amounts = Array(parts).fill(each) as number[];
  const drift = Math.round((total - each * parts) * 100) / 100;
  amounts[0] = Math.round((amounts[0] + drift) * 100) / 100;
  return amounts;
}

/**
 * @deprecated Use `formatCurrency` from `@/lib/utils`, or `<Money>` when the
 * amount is being rendered. Kept as an alias so the existing call sites in this
 * module and its consumers keep reading naturally.
 *
 * The previous implementation called `toLocaleString` directly on the argument,
 * which throws on a null amount.
 */
export const formatUsd = formatCurrency;

/** A transaction can only be split into expenses if nothing already claims it. */
export function canSplitIntoExpenses(txn: {
  invoice_id?: string | null;
  split_parent_id?: string | null;
}): { canSplit: boolean; reason?: string } {
  if (txn.split_parent_id) {
    return {
      canSplit: false,
      reason: "This is already part of a split transaction.",
    };
  }
  if (txn.invoice_id) {
    return {
      canSplit: false,
      reason: "This transaction is already linked to an expense.",
    };
  }
  return { canSplit: true };
}
