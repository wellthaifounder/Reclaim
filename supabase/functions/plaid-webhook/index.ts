// Reclaim — Plaid webhook receiver.
//
// Receives Plaid TRANSACTIONS webhooks (INITIAL_UPDATE / HISTORICAL_UPDATE /
// DEFAULT_UPDATE / SYNC_UPDATES_AVAILABLE), fetches the new transactions, and
// stores them in `transactions`. Medical transactions are additionally
// "captured" — a stub invoice with `lifecycle_status='captured'` is created
// per the Reclaim state machine (see PRODUCT_BRIEF.md §6) and the transaction
// is back-linked to it. Existing invoice matching from plaid-sync-transactions
// runs first; only unmatched medical transactions seed new CAPTURED invoices.
//
// Security model:
//   - This is a SERVER-TO-SERVER endpoint. Plaid is the caller; no end-user
//     JWT is present. The canonical edge-function checklist's user-auth step
//     is replaced with Plaid's own JWT-signed webhook verification (see
//     ../_shared/plaidWebhookVerification.ts).
//   - The handler uses SERVICE_ROLE_KEY because it must write across many
//     users' rows on Plaid's behalf. All writes are scoped by the resolved
//     plaid_connections.user_id — we never trust the webhook body's user.
//   - Replies 200 even on body-level errors after verification, so Plaid does
//     not retry indefinitely on a logic bug. Verification failure returns 401.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPlaidToken } from "../_shared/encryption.ts";
import {
  classifyTransaction,
  type PlaidTxnLike,
} from "../_shared/medicalClassifier.ts";
import { verifyPlaidWebhook } from "../_shared/plaidWebhookVerification.ts";

const PLAID_ENV =
  (Deno.env.get("PLAID_ENV") as "sandbox" | "development" | "production") ||
  "sandbox";

function plaidBaseUrl(): string {
  return {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  }[PLAID_ENV];
}

interface PlaidTransaction {
  transaction_id: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  date: string;
  category?: string[] | null;
  mcc?: string | null;
}

interface PlaidWebhookBody {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  new_transactions?: number;
  error?: { error_code?: string; error_message?: string } | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();

  // ── 1. Verify the Plaid signature ─────────────────────────────────────
  const plaidClientId = Deno.env.get("PLAID_CLIENT_ID");
  const plaidSecret = Deno.env.get("PLAID_SECRET");
  if (!plaidClientId || !plaidSecret) {
    console.error("[plaid-webhook] Missing PLAID_CLIENT_ID or PLAID_SECRET");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const verification = await verifyPlaidWebhook(
    req.headers.get("plaid-verification"),
    rawBody,
    { plaidEnv: PLAID_ENV, plaidClientId, plaidSecret },
  );
  if (!verification.ok) {
    console.warn("[plaid-webhook] Verification failed:", verification.reason);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 2. Parse + dispatch ──────────────────────────────────────────────
  let payload: PlaidWebhookBody;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[plaid-webhook] Missing Supabase env");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Only TRANSACTIONS webhooks trigger ingestion. Other types (ITEM,
    // AUTH, etc.) are accepted with a 200 so Plaid doesn't retry, and
    // logged for later wiring.
    if (payload.webhook_type !== "TRANSACTIONS") {
      console.log(
        "[plaid-webhook] Ignoring non-TRANSACTIONS webhook:",
        payload.webhook_type,
        payload.webhook_code,
      );
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const newTransactionsHint = payload.new_transactions ?? 0;
    console.log(
      "[plaid-webhook] TRANSACTIONS",
      payload.webhook_code,
      "item_id=",
      payload.item_id,
      "new=",
      newTransactionsHint,
    );

    // ── 3. Resolve the connection (and therefore the user) from item_id ─
    const { data: connection, error: connErr } = await supabase
      .from("plaid_connections")
      .select("id, user_id, encrypted_access_token, institution_name")
      .eq("item_id", payload.item_id)
      .maybeSingle();
    if (connErr || !connection) {
      console.warn(
        "[plaid-webhook] No connection for item_id",
        payload.item_id,
        connErr ? `(${connErr.message})` : "(not registered)",
      );
      // Ack so Plaid does not retry — connection may have been removed.
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const accessToken = await decryptPlaidToken(
      connection.encrypted_access_token,
    );

    // ── 4. Fetch the relevant window of transactions ────────────────────
    // INITIAL_UPDATE / HISTORICAL_UPDATE arrive after item creation and
    // imply Plaid has just finished pulling history. DEFAULT_UPDATE means
    // new transactions are available since the last sync. For Phase 2 we
    // use a generous 30-day default window; the historical activation
    // event (workstream 3) will expand this.
    const today = new Date();
    const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const txnsResp = await fetch(`${plaidBaseUrl()}/transactions/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: plaidClientId,
        secret: plaidSecret,
        access_token: accessToken,
        start_date: start.toISOString().split("T")[0],
        end_date: today.toISOString().split("T")[0],
      }),
    });
    const txnsBody = await txnsResp.json();
    if (!txnsResp.ok) {
      console.error("[plaid-webhook] /transactions/get failed:", txnsBody);
      // Ack so Plaid does not retry on credential errors that need manual fix.
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    const transactions: PlaidTransaction[] = txnsBody.transactions ?? [];

    // ── 5. Classify + persist ────────────────────────────────────────────
    const { data: userPrefs } = await supabase
      .from("user_vendor_preferences")
      .select("vendor_pattern, is_medical")
      .eq("user_id", connection.user_id);

    let captured = 0;
    let stored = 0;
    for (const txn of transactions) {
      const txnLike: PlaidTxnLike = {
        name: txn.name,
        merchant_name: txn.merchant_name,
        category: txn.category ?? null,
        mcc: txn.mcc ?? null,
      };
      const classification = await classifyTransaction(
        supabase,
        txnLike,
        userPrefs ?? [],
      );
      const vendor = txn.merchant_name || txn.name;

      // Upsert the raw transaction. Plaid IDs are stable so this is safe to
      // run on every webhook delivery — Plaid will fan-out delivers.
      const { data: txnRow, error: txnErr } = await supabase
        .from("transactions")
        .upsert(
          {
            user_id: connection.user_id,
            plaid_transaction_id: txn.transaction_id,
            transaction_date: txn.date,
            vendor,
            description: txn.name,
            amount: Math.abs(txn.amount),
            category: classification.isMedical
              ? "medical"
              : txn.category?.[0] || "Other",
            is_medical: classification.isMedical,
            is_hsa_eligible:
              classification.isMedical && !classification.needsReview,
            needs_review: classification.needsReview,
            // The DB check constraint allows only unlinked | linked_to_invoice
            // | ignored. We start as 'unlinked' and the auto-capture block
            // below upgrades to 'linked_to_invoice' once an invoice exists.
            reconciliation_status: "unlinked",
            source: "plaid",
          },
          { onConflict: "plaid_transaction_id", ignoreDuplicates: false },
        )
        .select("id, invoice_id")
        .single();
      if (txnErr) {
        console.warn(
          "[plaid-webhook] transactions upsert failed:",
          txnErr.message,
        );
        continue;
      }
      stored++;

      // Phase 2: medical transactions that aren't already linked to an
      // invoice seed a new CAPTURED invoice and back-link.
      if (
        classification.isMedical &&
        !txnRow.invoice_id &&
        // High-confidence (MCC or user_preference) routes to CAPTURED.
        // Low-confidence (keyword/category) still creates a stub so the
        // user sees it in their queue — but it's flagged needs_review.
        true
      ) {
        // Reclaim Phase 2 W3: source_plaid_transaction_id participates in a
        // partial UNIQUE index so this webhook and the initial historical
        // sync can't race-create duplicate invoices for the same Plaid txn.
        const { data: invoice, error: invErr } = await supabase
          .from("invoices")
          .insert({
            user_id: connection.user_id,
            vendor,
            amount: Math.abs(txn.amount),
            date: txn.date,
            category:
              classification.irsCategory ||
              (classification.isMedical ? "Medical" : "Other"),
            is_hsa_eligible: !classification.needsReview,
            // Reclaim Phase 3: same MCC-default classification as the
            // manual-sync path (see plaid-sync-transactions). High-confidence
            // MCC → PENDING_REVIEW with Pub 502 basis set; otherwise stay
            // in CAPTURED until classified.
            lifecycle_status: classification.pub502RuleId
              ? "pending_review"
              : "captured",
            eligibility_basis_rule_id: classification.pub502RuleId ?? null,
            classification_confidence: classification.pub502RuleId
              ? 0.95
              : null,
            classification_reasoning: classification.pub502RuleId
              ? `Auto-classified from MCC ${classification.mccCode} (${classification.irsCategory ?? "medical"}). Confirm during review.`
              : null,
            classified_at: classification.pub502RuleId
              ? new Date().toISOString()
              : null,
            source_plaid_transaction_id: txn.transaction_id,
            notes: `Auto-captured from Plaid (${classification.reason}${
              classification.mccCode ? ` MCC ${classification.mccCode}` : ""
            }).`,
          })
          .select("id")
          .single();
        if (invErr) {
          // 23505 = unique_violation. Manual sync got there first; link
          // the transaction row to the existing invoice and move on.
          if (invErr.code === "23505") {
            const { data: existing } = await supabase
              .from("invoices")
              .select("id")
              .eq("source_plaid_transaction_id", txn.transaction_id)
              .maybeSingle();
            if (existing) {
              await supabase
                .from("transactions")
                .update({
                  invoice_id: existing.id,
                  reconciliation_status: "linked_to_invoice",
                })
                .eq("id", txnRow.id);
            }
            continue;
          }
          console.warn(
            "[plaid-webhook] invoice insert failed:",
            invErr.message,
          );
          continue;
        }
        await supabase
          .from("transactions")
          .update({
            invoice_id: invoice.id,
            reconciliation_status: "linked_to_invoice",
          })
          .eq("id", txnRow.id);
        captured++;
      }
    }

    await supabase
      .from("plaid_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", connection.id);

    console.log(
      "[plaid-webhook] processed",
      stored,
      "transactions, captured",
      captured,
      "new invoices",
    );

    return new Response(JSON.stringify({ received: true, stored, captured }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Always ack 200 after verification has succeeded: Plaid retries on 5xx
    // for up to 24h, and a logic bug should be surfaced through logs, not a
    // retry storm. Errors are caught here to be safe.
    console.error(
      "[plaid-webhook] Error:",
      error instanceof Error ? error.message : error,
    );
    return new Response(JSON.stringify({ received: true, error: "logged" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
