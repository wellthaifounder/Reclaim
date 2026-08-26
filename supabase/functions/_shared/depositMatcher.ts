// Reclaim Workstream E4 — deposit → Substantiation Record matcher.
//
// Shared by plaid-sync-transactions and plaid-webhook so both paths surface
// the same candidates regardless of which channel delivered the deposit first.
//
// The matching itself moved into SQL (match_reimbursement_deposits, migration
// 20260817180000) for three reasons, each of which was a defect here:
//
//   * It used to run over the transactions of ONE sync. A record generated an
//     hour after its deposit posted was never matched, because nothing looked
//     at that deposit again. The SQL function scans open records against all
//     unresolved deposits, so it is safe — and useful — to call repeatedly.
//   * It used to upsert candidates with status 'pending' ON CONFLICT DO
//     UPDATE, which reinstated matches the user had dismissed, on every single
//     sync, for ever. The scan now does ON CONFLICT DO NOTHING.
//   * A per-transaction loop issued one SELECT over open records per deposit.
//     One call now handles the whole batch.
//
// This module is the call site, not the algorithm. Keeping the rule in the
// database is also what lets the Substantiation page run the same scan on load
// without a second implementation to drift from this one.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Scan for deposits that may close an open substantiation record.
 *
 * Failure is logged and swallowed, consistent with transfer and duplicate
 * detection: surfacing a reimbursement prompt is an improvement on top of
 * ingestion, never a precondition for it. A sync that aborted here would lose
 * the cursor advance for the whole batch.
 */
export async function findReimbursementMatches(opts: {
  supabase: SupabaseClient;
  userId: string;
  requestId?: string;
}): Promise<{ matched: number }> {
  const { supabase, userId } = opts;
  const tag = opts.requestId ? `[${opts.requestId}] ` : "";

  const { data, error } = await supabase.rpc("match_reimbursement_deposits", {
    p_user_id: userId,
  });

  if (error) {
    console.warn(`${tag}[depositMatcher] scan failed: ${error.message}`);
    return { matched: 0 };
  }
  return { matched: Number(data ?? 0) };
}
