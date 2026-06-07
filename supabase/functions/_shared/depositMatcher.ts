// Reclaim Phase 4 W3 — deposit → Substantiation Record matcher.
//
// Shared by plaid-sync-transactions and plaid-webhook so both paths surface
// the same set of reimbursement candidates regardless of which channel
// delivered the deposit txn first. Upsert semantics make the cross-path
// race a no-op (the UNIQUE (transaction_id, substantiation_record_id)
// constraint dedupes; the second writer just no-ops).
//
// Matching rule (v1, deliberately simple — fuzzy heuristics later if real
// users miss matches):
//   - rawTxnAmount must be < 0 (Plaid convention: negative = credit/deposit)
//   - open record means substantiation_records.status = 'generated'
//   - record must have been generated within the last 90 days (deposit-
//     delay sanity window; HSA custodians typically transfer within 1–14d)
//   - record.total_amount must match |rawTxnAmount| within $0.01
//
// All candidates are stamped match_confidence=1.0 because the matching is
// exact. The column is shaped to accept lower values for future relaxations
// (partial deposits, deposits split across records, etc.).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOLERANCE_USD = 0.01;
const WINDOW_DAYS = 90;

export async function findReimbursementMatches(opts: {
  supabase: SupabaseClient;
  userId: string;
  transactionRowId: string;
  rawTxnAmount: number;
}): Promise<{ matched: number }> {
  const { supabase, userId, transactionRowId, rawTxnAmount } = opts;
  if (rawTxnAmount >= 0) return { matched: 0 };
  const depositAmount = Math.abs(rawTxnAmount);

  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: records, error: recordErr } = await supabase
    .from("substantiation_records")
    .select("id, total_amount")
    .eq("user_id", userId)
    .eq("status", "generated")
    .gte("generated_at", windowStart);

  if (recordErr) {
    console.warn(
      "[depositMatcher] could not load open records:",
      recordErr.message,
    );
    return { matched: 0 };
  }

  let matched = 0;
  for (const r of records ?? []) {
    if (Math.abs(Number(r.total_amount) - depositAmount) > TOLERANCE_USD) {
      continue;
    }
    const { error: upsertErr } = await supabase
      .from("reimbursement_match_candidates")
      .upsert(
        {
          user_id: userId,
          transaction_id: transactionRowId,
          substantiation_record_id: r.id,
          match_amount: depositAmount,
          match_confidence: 1.0,
          match_reason: `Exact amount match within $${TOLERANCE_USD.toFixed(2)} tolerance, deposit within ${WINDOW_DAYS}d of record generation.`,
          status: "pending",
        },
        { onConflict: "transaction_id,substantiation_record_id" },
      );
    if (upsertErr) {
      console.warn(
        "[depositMatcher] candidate upsert failed:",
        upsertErr.message,
      );
      continue;
    }
    matched++;
  }
  return { matched };
}
