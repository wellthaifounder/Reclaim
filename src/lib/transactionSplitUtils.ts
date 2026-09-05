import type { Database } from "@/integrations/supabase/types";
import { formatCurrency } from "@/lib/utils";

type TransactionSplit =
  Database["public"]["Tables"]["transaction_splits"]["Row"];

export interface SplitFormData {
  hsa_account_id: string | null;
  amount: number;
  description: string;
  notes?: string;
}

/**
 * Validates that split amounts sum to the parent transaction amount
 */
export function validateSplitAmounts(
  splits: SplitFormData[],
  parentAmount: number,
): { isValid: boolean; message?: string } {
  if (splits.length === 0) {
    return { isValid: false, message: "At least one split is required" };
  }

  const totalSplitAmount = splits.reduce((sum, split) => sum + split.amount, 0);

  if (Math.abs(totalSplitAmount - parentAmount) > 0.01) {
    return {
      isValid: false,
      message: `Split amounts (${formatCurrency(totalSplitAmount)}) must equal transaction amount (${formatCurrency(parentAmount)})`,
    };
  }

  // Check for invalid amounts
  const hasInvalidAmount = splits.some((split) => split.amount <= 0);
  if (hasInvalidAmount) {
    return {
      isValid: false,
      message: "All split amounts must be greater than zero",
    };
  }

  return { isValid: true };
}

/**
 * Calculates the remaining amount that hasn't been allocated to splits
 */
export function calculateRemainingAmount(
  splits: SplitFormData[],
  parentAmount: number,
): number {
  const totalAllocated = splits.reduce((sum, split) => sum + split.amount, 0);
  return Math.max(0, parentAmount - totalAllocated);
}

/**
 * Determines if a transaction can be split
 */
export function canTransactionBeSplit(transaction: {
  is_split?: boolean;
  split_parent_id?: string | null;
  invoice_id?: string | null;
}): { canSplit: boolean; reason?: string } {
  // Can't split a transaction that's already a split child
  if (transaction.split_parent_id) {
    return {
      canSplit: false,
      reason: "This is already part of a split transaction",
    };
  }

  // Can't split a transaction that's already split (already has children)
  if (transaction.is_split) {
    return { canSplit: false, reason: "This transaction is already split" };
  }

  // Can't split a transaction that's linked to a bill
  if (transaction.invoice_id) {
    return {
      canSplit: false,
      reason: "Cannot split transactions that are linked to bills",
    };
  }

  return { canSplit: true };
}

/**
 * Formats split information for display
 */
export function formatSplitSummary(splits: TransactionSplit[]): string {
  if (splits.length === 0) return "No splits";
  if (splits.length === 1) return "1 split";
  return `${splits.length} splits`;
}

/**
 * Groups splits by HSA account
 */
export function groupSplitsByAccount(
  splits: TransactionSplit[],
): Map<string | null, TransactionSplit[]> {
  const grouped = new Map<string | null, TransactionSplit[]>();

  splits.forEach((split) => {
    const accountId = split.hsa_account_id;
    if (!grouped.has(accountId)) {
      grouped.set(accountId, []);
    }
    grouped.get(accountId)!.push(split);
  });

  return grouped;
}
