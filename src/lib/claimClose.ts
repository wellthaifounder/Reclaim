// Launch plan L3 (Batch 2) -- closing a sent claim by hand ("I got paid"),
// and the money arithmetic every screen needs to agree with it.
//
// Dependency-free so `npm test` (node --test) can run it directly.

/** Round to cents the way the database's NUMERIC(12,2) columns do. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What is still owed on one expense: the reimbursable amount less whatever has
 * already come back, floored at zero.
 *
 * The same expression as substantiatable_expenses() and
 * expense_remaining_amount() in the database. After a claim is paid short
 * (L3), the expense is "ready to claim" again for THIS figure, not for the
 * billed amount -- so any screen that totals ready-to-claim money has to use
 * it, or it will disagree with the Reimburse page.
 */
export function remainingOf(row: {
  amount: number | string | null;
  amount_paid?: number | string | null;
  reimbursable_amount?: number | string | null;
  reimbursed_amount?: number | string | null;
}): number {
  const ceiling = Number(
    row.reimbursable_amount ?? row.amount_paid ?? row.amount ?? 0,
  );
  return Math.max(cents(ceiling - Number(row.reimbursed_amount ?? 0)), 0);
}

export type AmountCheck =
  | { ok: true; amount: number; shortfall: number }
  | { ok: false; problem: string };

/**
 * Check the "amount received" field before it reaches the database.
 *
 * Mirrors close_claim_by_hand's own refusals, so the person sees the problem
 * beside the field instead of after a round trip. The database still enforces
 * every one of these; this is for the message, not for safety.
 */
export function checkAmountReceived(
  input: string,
  claimTotal: number,
  expenseCount: number,
): AmountCheck {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return { ok: false, problem: "Enter the amount." };
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) {
    return { ok: false, problem: "Enter an amount like 120.50." };
  }
  const amount = cents(Number(cleaned));
  const total = cents(claimTotal);
  if (amount <= 0) {
    return {
      ok: false,
      problem:
        "If nothing was paid, withdraw the claim instead — its expenses go back to ready to claim.",
    };
  }
  if (amount > total) {
    return {
      ok: false,
      problem: `That's more than the ${formatUsd(total)} you claimed.`,
    };
  }
  const shortfall = cents(total - amount);
  // L3 open decision: how a short payment splits across several expenses.
  // Until it is made, the database refuses it, so say so here first.
  if (shortfall > 0 && expenseCount > 1) {
    return {
      ok: false,
      problem:
        "Short payments on claims with more than one expense aren't supported yet. If you were paid in full, leave the full amount.",
    };
  }
  return { ok: true, amount, shortfall };
}

/** Turn a close_claim_by_hand refusal into something a person can act on. */
export function explainCloseFailure(message: string): string {
  if (/CLOSE_WRONG_STATUS/.test(message)) {
    return "That claim has already moved on since this page loaded. We've refreshed the list.";
  }
  if (/CLOSE_NOT_FOUND|CLOSE_NOT_A_CLAIM|CLOSE_EMPTY/.test(message)) {
    return "That claim could not be found. Please reload and try again.";
  }
  if (/CLOSE_BAD_AMOUNT/.test(message)) {
    return "The amount received must be more than zero.";
  }
  if (/CLOSE_TOO_MUCH/.test(message)) {
    return "That's more than the claim total.";
  }
  if (/CLOSE_SHORT_SPLIT_UNDECIDED/.test(message)) {
    return "Short payments on claims with more than one expense aren't supported yet.";
  }
  return "Couldn't close that claim. Please try again.";
}

/**
 * Why this year's expenses that are in the record are not in the claimable
 * total, by reason. The Reimburse page used to call all of them "already paid
 * from the HSA", which mislabelled every expense sitting in a claim the user
 * had just sent (Batch 2, problem 1).
 */
export function notClaimableBreakdown(
  rows: { claimable: boolean; claimState: string }[],
): { inSentClaim: number; paidByHsaCard: number; reimbursed: number } {
  let inSentClaim = 0;
  let paidByHsaCard = 0;
  let reimbursed = 0;
  for (const r of rows) {
    if (r.claimable) continue;
    if (r.claimState === "locked_in_request") inSentClaim++;
    else if (r.claimState === "not_reimbursable") paidByHsaCard++;
    else if (r.claimState === "reimbursed") reimbursed++;
  }
  return { inSentClaim, paidByHsaCard, reimbursed };
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
