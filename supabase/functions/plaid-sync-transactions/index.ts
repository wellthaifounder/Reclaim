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
import {
  detectDuplicates,
  detectTransfers,
  matchDeposits,
} from "../_shared/autoCapture.ts";
import {
  syncAccounts,
  syncTransactions,
  type PlaidCreds,
} from "../_shared/plaidSync.ts";
import { plaidBaseUrl } from "../_shared/plaidEnv.ts";
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

// Environment resolution lives in _shared/plaidEnv.ts and throws rather than
// falling back to sandbox. See that file for why.
const getPlaidUrl = plaidBaseUrl;

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
    let exceptionCount = 0;
    let capturedCount = 0;

    const medicalTransactions = ingested.filter(
      (t) => t.is_medical && t.reconciliation_status !== "linked_to_invoice",
    );

    // ── 3. Auto-link to existing open invoices ────────────────────────────
    // Only invoices the HSA has not already settled are candidates for
    // auto-linking. Replaces `is_reimbursed = false`, a derived column being
    // retired: it was false for 'not_reimbursable' too, so a bill already paid
    // with the HSA card stayed an auto-link candidate.
    const { data: userInvoices } = await supabase
      .from("invoices")
      .select("id, vendor, amount, date, invoice_date, status")
      .eq("user_id", user.id)
      .not(
        "claim_state",
        "in",
        "(reimbursed,reimbursed_externally,not_reimbursable)",
      )
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
        //
        // This used to write a `payment_transactions` row as well as setting
        // the link below (2026-08-21). That table is gone. It recorded the
        // same fact twice: the transaction knows which expense it belongs to,
        // and the expense knows which transaction it came from, so a third
        // record joining them could only ever add a way for the three to
        // disagree. `payment_source` was the one thing it carried that nothing
        // else did, and it was derived from `plaid_accounts.is_hsa` — which
        // auto-capture already reads, to set claim_state 'not_reimbursable'
        // on HSA-card spend at the moment the expense is created.
        if (bestMatch.confidence >= 0.9) {
          const { error: linkError } = await supabase
            .from("transactions")
            .update({
              invoice_id: bestMatch.invoiceId,
              reconciliation_status: "linked_to_invoice",
            })
            .eq("id", txn.id);

          if (!linkError) {
            autoLinkedCount++;
            txn.reconciliation_status = "linked_to_invoice";
            const idx = openInvoices.findIndex(
              (i) => i.id === bestMatch!.invoiceId,
            );
            if (idx !== -1) openInvoices.splice(idx, 1);
          } else {
            console.error(
              `[${requestId}] Auto-link failed for txn ${txn.id}:`,
              linkError.message,
            );
            exceptionCount++;
          }
        }
        // Tier 2 used to write a transaction_invoice_suggestion for the user
        // to confirm. That feature is removed (20260815170000): it is the
        // bidirectional matching the workflow spec defers to v1.1, and the
        // inbox item it fed had never once been generated. A middling match
        // is now simply an exception, the same as a weak one.
        else {
          exceptionCount++;
        }
      }

      console.log(
        `[${requestId}] Auto-matching: ${autoLinkedCount} auto-linked, ${exceptionCount} exceptions`,
      );
    }

    // ── 3b. Transfer detection (Workstream C5) ────────────────────────────
    // Before capture, deliberately: a card payment out of checking can carry
    // the card's name and classify as medical, and capturing it first creates
    // a phantom expense on top of the double-counted spend.
    const transferPairs = await detectTransfers(supabase, {
      userId: user.id,
      requestId,
      // The initial import reaches back 18 months, so transfer detection has
      // to sweep the same ground or the history it just pulled arrives with
      // its card payments still counted as spending. Routine syncs keep the
      // 45-day default: only the last few days are ever new.
      lookbackDays: is_initial ? 550 : undefined,
    });

    // ── 4. Capture ────────────────────────────────────────────────────────
    // Expenses are no longer created here (2026-09-06). A sync must never file
    // a claim the user has not approved, and the classifier now leaves every
    // medical signal in the review queue. Creation moved into the database, on
    // the transition to confirmed — trigger `trg_transactions_confirm_medical`,
    // which also catches the rule-confirmed rows this sync just inserted, and
    // every other route that was previously stranding money.
    // Counted from the database rather than the `ingested` snapshot, which was
    // built before the trigger ran and so still shows every row unlinked.
    if (ingested.length > 0) {
      const { count, error: capturedErr } = await supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in(
          "source_transaction_id",
          ingested.map((t) => t.id),
        );
      if (capturedErr) {
        console.warn(
          `[${requestId}] Could not count captured expenses: ${capturedErr.message}`,
        );
      } else {
        capturedCount = count ?? 0;
      }
    }

    // ── 5. Deposit → Substantiation Record matching ───────────────────────
    const depositCandidates = await matchDeposits(supabase, {
      userId: user.id,
      requestId,
    });
    if (depositCandidates > 0) {
      console.log(
        `[${requestId}] Surfaced ${depositCandidates} reimbursement candidate(s).`,
      );
    }

    // ── 5b. Duplicate detection (Workstream C6) ───────────────────────────
    // After capture, deliberately: the expense this sync just created is one
    // half of every pair worth finding. The costly case is a charge the user
    // already entered by hand on the day of the visit, which the bank now
    // hands them a second time.
    const duplicateCandidates = await detectDuplicates(supabase, {
      userId: user.id,
      requestId,
    });

    await supabase.from("matching_run_log").insert({
      user_id: user.id,
      trigger_source: "plaid_sync",
      transactions_processed: medicalTransactions.length,
      auto_linked_count: autoLinkedCount,
      // suggested_count omitted — defaults to 0. Match suggestions were
      // removed in 20260815170000.
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
        transfers_matched: transferPairs,
        captured: capturedCount,
        duplicate_candidates: duplicateCandidates,
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
