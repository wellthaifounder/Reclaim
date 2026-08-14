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

  const unlinkedMedical = opts.ingested.filter(
    (t) =>
      t.is_medical &&
      t.reconciliation_status !== "linked_to_invoice" &&
      !t.invoice_id,
  );

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
