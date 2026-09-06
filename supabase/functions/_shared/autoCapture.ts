// Reclaim — post-ingestion pipeline shared by plaid-sync-transactions and
// plaid-webhook.
//
// This logic previously existed twice, once in each function, and the copies
// drifted: the manual-sync copy declared a `classifications` array whose type
// omitted `pub502RuleId`, then read `c?.pub502RuleId` when building the
// invoice. It was always undefined, so identical transactions landed in
// different lifecycle states depending on whether the webhook or the manual
// sync happened to see them first. Extracting the pipeline is what stops that
// class of bug recurring.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findReimbursementMatches } from "./depositMatcher.ts";

/**
 * Workstream C5 — pair up money moved between the user's own accounts.
 *
 * MUST run before anything can confirm a transaction as medical. A credit-card
 * payment from checking can carry the card's name in the descriptor and
 * classify as medical; leave it unflagged and the user is offered a phantom
 * expense for money that was never spent at a provider, on top of the
 * double-count in their totals. The expense trigger refuses transfers outright,
 * but only once this has marked them as such.
 *
 * Failure is logged and swallowed. Transfer detection is an accuracy
 * improvement, not a precondition for ingesting transactions, and a sync that
 * aborts here would lose the cursor advance for the whole batch.
 */
export async function detectTransfers(
  supabase: SupabaseClient,
  opts: { userId: string; requestId?: string; lookbackDays?: number },
): Promise<number> {
  const tag = opts.requestId ? `[${opts.requestId}] ` : "";
  const { data, error } = await supabase.rpc("detect_transfers", {
    p_user_id: opts.userId,
    // The SQL default is 45 days, which is right for a routine sync where only
    // the last few days are new. It is wrong for the initial import, which
    // pulls up to 18 months: every credit-card payment older than 45 days was
    // left unmatched and counted as spending, inflating the "we found $X"
    // figure on the one screen where the number has to be trustworthy — and
    // risking a phantom medical expense for money that only moved between the
    // user's own accounts. Found by seeding 18 months of realistic history:
    // three identical card payments, the two recent ones matched, the 73-day-
    // old one silently missed.
    ...(opts.lookbackDays ? { p_lookback_days: opts.lookbackDays } : {}),
  });
  if (error) {
    console.warn(`${tag}[transfers] detection failed: ${error.message}`);
    return 0;
  }
  const pairs = data ?? 0;
  if (pairs > 0) {
    console.log(`${tag}[transfers] matched ${pairs} movement(s)`);
  }
  return pairs;
}

/**
 * Workstream C6 — raise candidate duplicate expense pairs.
 *
 * MUST run after ingestion: any expense created during this sync (by a
 * rule confirming a transaction outright) is one half of every pair worth
 * finding. The case that costs real money is a
 * user who entered a charge by hand on the day of the visit and is now handed
 * a second record for it by the bank — both eligible, both unclaimed, both
 * selectable into a reimbursement request.
 *
 * Raises warnings only; it never merges. A wrong auto-merge would silently
 * delete a real expense, which is worse than the double-count it would be
 * preventing.
 *
 * Failure is logged and swallowed, for the same reason as transfer detection:
 * this is an accuracy improvement, not a precondition for ingesting, and
 * aborting here would lose the cursor advance for the whole batch.
 */
export async function detectDuplicates(
  supabase: SupabaseClient,
  opts: { userId: string; requestId?: string },
): Promise<number> {
  const tag = opts.requestId ? `[${opts.requestId}] ` : "";
  const { data, error } = await supabase.rpc("detect_duplicate_expenses", {
    p_user_id: opts.userId,
  });
  if (error) {
    console.warn(`${tag}[duplicates] detection failed: ${error.message}`);
    return 0;
  }
  const found = data ?? 0;
  if (found > 0) {
    console.log(`${tag}[duplicates] raised ${found} candidate pair(s)`);
  }
  return found;
}

/**
 * Workstream E4 — surface deposits that may close an open claim.
 *
 * MUST run after detectTransfers. The strongest signal the matcher has is C5's
 * verdict that the money came out of the HSA, and that is the signal that lets
 * a fee-sized gap be shown at all rather than discarded. Run this first and
 * every match is scored as though the deposit came from nowhere.
 *
 * No longer a loop over this batch's credits: the scan covers every unresolved
 * deposit against every open record, which is what finally catches the deposit
 * that posted before the record it pays for was generated.
 */
export async function matchDeposits(
  supabase: SupabaseClient,
  opts: { userId: string; requestId?: string },
): Promise<number> {
  const { matched } = await findReimbursementMatches({
    supabase,
    userId: opts.userId,
    requestId: opts.requestId,
  });
  return matched;
}
