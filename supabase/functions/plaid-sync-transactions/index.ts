// Reclaim — manual / initial Plaid transaction sync.
//
// Rewritten 2026-08-12 for the bank-sync rebuild. Ingestion now runs through
// ../_shared/plaidSync.ts on Plaid's cursor-based /transactions/sync. What
// changed and why:
//
//   - The old implementation called /transactions/get with no count/offset, so
//     Plaid's default of 100 applied. The 540-day "historical wow moment" pull
//     was silently truncated to 100 transactions.
//   - Date-window fetches never surfaced removed or modified transactions.
//     Voided charges persisted forever, and because the manual path used
//     ignoreDuplicates: true, pending→posted amount corrections never landed.
//   - `account_id` was dropped, so an HSA account was indistinguishable from
//     checking. Accounts are now persisted and every transaction is linked.
//
// `is_initial` no longer selects a date window (the cursor handles history
// automatically); it now only controls the first-sync bookkeeping that drives
// the activation screen.
//
// Everything downstream of ingestion — invoice auto-linking, auto-capture, and
// deposit matching — is preserved as-is. Moving eligibility out of ingestion
// and splitting transactions from expenses are Workstreams B and C.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPlaidToken } from "../_shared/encryption.ts";
import { autoCaptureExpenses, matchDeposits } from "../_shared/autoCapture.ts";
import {
  syncAccounts,
  syncTransactions,
  type PlaidCreds,
} from "../_shared/plaidSync.ts";
import Resend from "https://esm.sh/resend@2.0.0";

const allowedOrigins = [
  "https://reclaim.health",
  "https://www.reclaim.health",
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter(Boolean);

function getCorsHeaders(requestOrigin: string | null) {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[1];
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

const getPlaidUrl = (): string => {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  const urls: Record<string, string> = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  };
  return urls[env] || urls["sandbox"];
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Track enough context to send a failure notification if the sync errors out
  const syncCtx: { userEmail?: string; institutionName?: string } = {};

  try {
    const requestId = crypto.randomUUID();
    const { connection_id, is_initial } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const creds: PlaidCreds = {
      clientId: Deno.env.get("PLAID_CLIENT_ID")!,
      secret: Deno.env.get("PLAID_SECRET")!,
      baseUrl: getPlaidUrl(),
    };

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error("Auth error:", userError);
      throw new Error("Unauthorized");
    }
    syncCtx.userEmail = user.email;

    console.log(`[${requestId}] Syncing transactions`);

    const { data: connection, error: connectionError } = await supabase
      .from("plaid_connections")
      .select(
        "id, encrypted_access_token, item_id, institution_name, transactions_cursor",
      )
      .eq("id", connection_id)
      .eq("user_id", user.id)
      .single();

    if (connectionError || !connection) {
      console.error("Connection error:", connectionError);
      throw new Error("Connection not found");
    }
    syncCtx.institutionName = connection.institution_name;

    console.log(`[${requestId}] Decrypting Plaid access token`);
    const access_token = await decryptPlaidToken(
      connection.encrypted_access_token,
    );

    // ── 1. Refresh accounts ───────────────────────────────────────────────
    // Must happen before transaction ingest so every row can be linked to its
    // account. Also picks up accounts added to the Item since link time.
    const accountMap = await syncAccounts(supabase, {
      connectionId: connection.id,
      userId: user.id,
      accessToken: access_token,
      creds,
    });

    // ── 2. Ingest via cursor ──────────────────────────────────────────────
    // Workstream C3: categorization_rules replaces user_vendor_preferences.
    const { data: rules } = await supabase
      .from("categorization_rules")
      .select("id, match_type, match_value, is_medical, display_label")
      .eq("user_id", user.id);

    const { counts, ingested } = await syncTransactions(supabase, {
      connectionId: connection.id,
      userId: user.id,
      accessToken: access_token,
      creds,
      cursor: connection.transactions_cursor,
      accountMap,
      rules: rules ?? [],
    });

    console.log(
      `[${requestId}] Ingested: +${counts.added} ~${counts.modified} -${counts.removed} across ${counts.pages} page(s)`,
    );

    const matchStartTime = Date.now();
    let autoLinkedCount = 0;
    let suggestedCount = 0;
    let exceptionCount = 0;
    let capturedCount = 0;

    const medicalTransactions = ingested.filter(
      (t) => t.is_medical && t.reconciliation_status !== "linked_to_invoice",
    );

    // ── 3. Auto-link to existing open invoices ────────────────────────────
    const { data: userInvoices } = await supabase
      .from("invoices")
      .select("id, vendor, amount, date, invoice_date, status")
      .eq("user_id", user.id)
      .eq("is_reimbursed", false)
      .in("status", ["unpaid", "partially_paid"]);

    const { data: vendorAliases } = await supabase
      .from("vendor_aliases")
      .select("canonical_vendor, alias")
      .eq("user_id", user.id);

    const openInvoices = [...(userInvoices ?? [])];
    const aliases = vendorAliases ?? [];

    if (medicalTransactions.length > 0 && openInvoices.length > 0) {
      for (const txn of medicalTransactions) {
        const txnVendor = (txn.vendor || txn.description || "")
          .toLowerCase()
          .trim();
        let bestMatch: { invoiceId: string; confidence: number } | null = null;

        for (const invoice of openInvoices) {
          let confidence = 0;
          const invVendor = invoice.vendor.toLowerCase().trim();

          // Vendor match (40% weight) — direct, then aliases, then fuzzy
          let vendorScore = 0;
          if (txnVendor === invVendor) {
            vendorScore = 1.0;
          } else if (
            txnVendor.includes(invVendor) ||
            invVendor.includes(txnVendor)
          ) {
            vendorScore = 0.8;
          } else {
            const aliasMatch = aliases.some((a) => {
              const canonical = a.canonical_vendor.toLowerCase().trim();
              const aliasText = a.alias.toLowerCase().trim();
              return (
                (invVendor.includes(canonical) ||
                  canonical.includes(invVendor)) &&
                (txnVendor.includes(aliasText) || aliasText.includes(txnVendor))
              );
            });
            if (aliasMatch) vendorScore = 1.0;
          }
          confidence += vendorScore * 0.4;

          // Amount match (40% weight) — within 2% tolerance
          const amountDiff = Math.abs(txn.amount - Number(invoice.amount));
          const avgAmount = (txn.amount + Number(invoice.amount)) / 2;
          if (avgAmount > 0 && amountDiff <= avgAmount * 0.02) {
            confidence += 0.4;
          }

          // Date proximity (20% weight)
          const invoiceDate = invoice.invoice_date || invoice.date;
          if (invoiceDate) {
            const daysDiff = Math.abs(
              (new Date(txn.transaction_date).getTime() -
                new Date(invoiceDate).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            if (daysDiff <= 3) confidence += 0.2;
            else if (daysDiff <= 7) confidence += 0.1;
          }

          if (
            confidence > 0.5 &&
            (!bestMatch || confidence > bestMatch.confidence)
          ) {
            bestMatch = { invoiceId: invoice.id, confidence };
          }
        }

        if (!bestMatch) {
          exceptionCount++;
          continue;
        }

        // Tier 1: auto-link
        if (bestMatch.confidence >= 0.9) {
          const { error: paymentError } = await supabase
            .from("payment_transactions")
            .insert({
              invoice_id: bestMatch.invoiceId,
              transaction_id: txn.id,
              user_id: user.id,
              payment_date: txn.transaction_date,
              amount: txn.amount,
              // An HSA-account charge is a direct distribution, not an
              // out-of-pocket payment awaiting reimbursement.
              // Spend on an HSA card is a direct distribution, not an
              // out-of-pocket payment awaiting reimbursement. The flag rides
              // along on the ingested row (resolved from plaid_accounts.is_hsa,
              // which honours the user's override).
              payment_source: txn.is_hsa_account
                ? "hsa_direct"
                : "out_of_pocket",
              auto_linked: true,
              auto_linked_at: new Date().toISOString(),
              match_confidence: bestMatch.confidence,
              notes: `Auto-linked from Plaid sync (${Math.round(bestMatch.confidence * 100)}% confidence)`,
            });

          if (!paymentError) {
            await supabase
              .from("transactions")
              .update({
                invoice_id: bestMatch.invoiceId,
                reconciliation_status: "linked_to_invoice",
              })
              .eq("id", txn.id);

            autoLinkedCount++;
            txn.reconciliation_status = "linked_to_invoice";
            const idx = openInvoices.findIndex(
              (i) => i.id === bestMatch!.invoiceId,
            );
            if (idx !== -1) openInvoices.splice(idx, 1);
          } else {
            console.error(
              `[${requestId}] Auto-link failed for txn ${txn.id}:`,
              paymentError.message,
            );
            exceptionCount++;
          }
        }
        // Tier 2: suggestion
        else if (bestMatch.confidence >= 0.7) {
          await supabase.from("transaction_invoice_suggestions").upsert(
            {
              transaction_id: txn.id,
              invoice_id: bestMatch.invoiceId,
              confidence_score: Math.round(bestMatch.confidence * 100),
              match_reason: `Vendor + amount + date match (${Math.round(bestMatch.confidence * 100)}%)`,
            },
            { onConflict: "transaction_id,invoice_id" },
          );
          suggestedCount++;
        }
        // Tier 3: exception
        else {
          exceptionCount++;
        }
      }

      console.log(
        `[${requestId}] Auto-matching: ${autoLinkedCount} auto-linked, ${suggestedCount} suggested, ${exceptionCount} exceptions`,
      );
    }

    // ── 4. Auto-capture ───────────────────────────────────────────────────
    // Shared with plaid-webhook. `classification` now travels with each
    // ingested row, so the Pub 502 rule id is available — the previous
    // implementation looked it up in a parallel array whose type omitted the
    // field, so the manual-sync path never stamped a rule and never routed to
    // PENDING_REVIEW.
    capturedCount = await autoCaptureExpenses(supabase, {
      userId: user.id,
      ingested,
      requestId,
    });

    // ── 5. Deposit → Substantiation Record matching ───────────────────────
    const depositCandidates = await matchDeposits(supabase, {
      userId: user.id,
      ingested,
    });
    if (depositCandidates > 0) {
      console.log(
        `[${requestId}] Surfaced ${depositCandidates} reimbursement candidate(s).`,
      );
    }

    await supabase.from("matching_run_log").insert({
      user_id: user.id,
      trigger_source: "plaid_sync",
      transactions_processed: medicalTransactions.length,
      auto_linked_count: autoLinkedCount,
      suggested_count: suggestedCount,
      exception_count: exceptionCount,
      duration_ms: Date.now() - matchStartTime,
    });

    // ── 6. Connection bookkeeping ─────────────────────────────────────────
    // `last_synced_at` and the cursor are committed inside syncTransactions;
    // only the one-time activation counters are written here.
    const medicalDetected = counts.medical;
    const ingestedTotal = counts.added + counts.modified;

    if (is_initial) {
      await supabase
        .from("plaid_connections")
        .update({
          first_sync_completed_at: new Date().toISOString(),
          initial_medical_count: medicalDetected,
          initial_total_count: ingestedTotal,
        })
        .eq("id", connection_id);
    }

    // Report the history we actually covered rather than a hardcoded window —
    // with cursor sync, coverage is whatever Plaid holds for the Item.
    const oldest = ingested.reduce<string | null>(
      (min, t) => (!min || t.transaction_date < min ? t.transaction_date : min),
      null,
    );
    const windowDays = oldest
      ? Math.max(
          1,
          Math.round(
            (Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        is_initial: !!is_initial,
        total: ingestedTotal,
        inserted: counts.added,
        modified: counts.modified,
        removed: counts.removed,
        medical_detected: medicalDetected,
        auto_linked: autoLinkedCount,
        suggested_matches: suggestedCount,
        captured: capturedCount,
        window_days: windowDays,
        institution_name: connection.institution_name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(
      "[plaid-sync-transactions] Error:",
      error instanceof Error ? error.message : error,
    );

    if (syncCtx.userEmail) {
      try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (resendKey) {
          const resend = new Resend.Resend(resendKey);
          const institution = syncCtx.institutionName || "your bank";
          await resend.emails.send({
            from: "Reclaim <notifications@wellth-ai.app>",
            to: [syncCtx.userEmail],
            subject: `Action needed: ${institution} sync failed`,
            html: `
              <h2>Bank sync failed</h2>
              <p>We were unable to sync transactions from <strong>${institution}</strong>.</p>
              <p>This can happen when your bank connection needs to be refreshed. Please log in to Reclaim and reconnect your bank account to restore automatic syncing.</p>
              <p>Best regards,<br>The Reclaim Team</p>
            `,
          });
        }
      } catch (emailErr) {
        console.error(
          "[plaid-sync-transactions] Failed to send failure notification:",
          emailErr instanceof Error ? emailErr.message : emailErr,
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "Failed to sync transactions. Please try again.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
