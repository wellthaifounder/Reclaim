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
import type { IngestedTransaction } from "./plaidSync.ts";

/**
 * Workstream C5 — pair up money moved between the user's own accounts.
 *
 * MUST run before autoCaptureExpenses. A credit-card payment from checking can
 * carry the card's name in the descriptor and classify as medical; capture it
 * first and the user gets a phantom expense for money that was never spent at
 * a provider, on top of the double-count in their totals.
 *
 * Failure is logged and swallowed. Transfer detection is an accuracy
 * improvement, not a precondition for ingesting transactions, and a sync that
 * aborts here would lose the cursor advance for the whole batch.
 */
export async function detectTransfers(
  supabase: SupabaseClient,
  opts: { userId: string; requestId?: string },
): Promise<number> {
  const tag = opts.requestId ? `[${opts.requestId}] ` : "";
  const { data, error } = await supabase.rpc("detect_transfers", {
    p_user_id: opts.userId,
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
 * Create CAPTURED invoices for medical transactions that aren't already linked
 * to one, and back-link the transaction row.
 *
 * Race safety: `invoices.source_plaid_transaction_id` carries a partial UNIQUE
 * index, so when the webhook and a manual sync process the same transaction
 * concurrently one of them takes a 23505 and back-links to the winner's row
 * instead of creating a duplicate.
 */
export async function autoCaptureExpenses(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    ingested: IngestedTransaction[];
    requestId?: string;
  },
): Promise<number> {
  const tag = opts.requestId ? `[${opts.requestId}] ` : "";
  let captured = 0;

  const candidates = opts.ingested.filter(
    (t) =>
      t.is_medical &&
      t.reconciliation_status !== "linked_to_invoice" &&
      !t.invoice_id,
  );

  // Re-read is_transfer rather than trusting the ingested snapshot: those rows
  // were classified before detectTransfers ran, so a credit-card payment still
  // looks medical in that array. Without this the transfer is excluded from
  // totals but still spawns a phantom expense.
  let transferIds = new Set<string>();
  if (candidates.length > 0) {
    const { data: transfers, error: transferErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("is_transfer", true)
      .in(
        "id",
        candidates.map((t) => t.id),
      );
    if (transferErr) {
      // Capturing a transfer as an expense is the worse outcome, but so is
      // dropping every capture because one query failed. Log and proceed.
      console.warn(
        `${tag}[capture] could not check transfer status: ${transferErr.message}`,
      );
    } else {
      transferIds = new Set((transfers ?? []).map((t) => t.id as string));
    }
  }

  const unlinkedMedical = candidates.filter((t) => !transferIds.has(t.id));
  if (transferIds.size > 0) {
    console.log(
      `${tag}[capture] skipped ${transferIds.size} transfer(s) — money moved, not spent`,
    );
  }

  for (const txn of unlinkedMedical) {
    const c = txn.classification;

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        user_id: opts.userId,
        vendor: txn.vendor || txn.description,
        amount: txn.amount,
        date: txn.transaction_date,
        category: c.irsCategory || "Medical",
        // Workstream B/C2: eligibility is NOT decided at ingestion. It depends
        // on date of service, patient and Pub 502 category, none of which are
        // known when a bank transaction arrives — so the expense starts
        // 'unknown' and substantiation resolves it. `is_hsa_eligible` and
        // `lifecycle_status` are now derived from the facets and reject writes.
        eligibility_state: "unknown",
        documentation_state: "none",
        // Spend on an HSA card is a distribution: it still needs
        // substantiation, but it can never become a reimbursement request.
        claim_state: txn.is_hsa_account ? "not_reimbursable" : "unclaimed",
        amount_paid: txn.amount,
        reimbursable_amount: txn.amount,
        source_transaction_id: txn.id,
        eligibility_basis_rule_id: c.pub502RuleId ?? null,
        classification_confidence: c.pub502RuleId ? 0.95 : null,
        classification_reasoning: c.pub502RuleId
          ? `Auto-classified from MCC ${c.mccCode} (${c.irsCategory ?? "medical"}). Confirm during review.`
          : null,
        classified_at: c.pub502RuleId ? new Date().toISOString() : null,
        source_plaid_transaction_id: txn.plaid_transaction_id,
        notes: `Auto-captured from Plaid (${c.reason}${
          c.mccCode ? ` MCC ${c.mccCode}` : ""
        }).`,
      })
      .select("id")
      .single();

    if (invErr) {
      if (invErr.code === "23505") {
        const { data: existing } = await supabase
          .from("invoices")
          .select("id")
          .eq("source_plaid_transaction_id", txn.plaid_transaction_id)
          .maybeSingle();
        if (existing) {
          await supabase
            .from("transactions")
            .update({
              invoice_id: existing.id,
              reconciliation_status: "linked_to_invoice",
            })
            .eq("id", txn.id);
          txn.invoice_id = existing.id;
          txn.reconciliation_status = "linked_to_invoice";
        }
        continue;
      }
      console.warn(
        `${tag}Auto-capture failed for txn ${txn.id}:`,
        invErr.message,
      );
      continue;
    }

    const { error: updateErr } = await supabase
      .from("transactions")
      .update({
        invoice_id: invoice.id,
        reconciliation_status: "linked_to_invoice",
      })
      .eq("id", txn.id);

    if (!updateErr) {
      txn.invoice_id = invoice.id;
      txn.reconciliation_status = "linked_to_invoice";
      captured++;
    }
  }

  return captured;
}

/**
 * Surface reimbursement-deposit candidates for credits.
 *
 * Reads the stored `signed_amount` (Plaid convention: negative = money into
 * the account) rather than the raw API payload, so this no longer has to run
 * inside the same request that fetched the transaction.
 */
export async function matchDeposits(
  supabase: SupabaseClient,
  opts: { userId: string; ingested: IngestedTransaction[] },
): Promise<number> {
  let candidates = 0;
  for (const txn of opts.ingested) {
    if (txn.signed_amount >= 0) continue;
    const { matched } = await findReimbursementMatches({
      supabase,
      userId: opts.userId,
      transactionRowId: txn.id,
      rawTxnAmount: txn.signed_amount,
    });
    candidates += matched;
  }
  return candidates;
}
