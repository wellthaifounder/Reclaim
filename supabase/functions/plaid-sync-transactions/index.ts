import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPlaidToken } from "../_shared/encryption.ts";
import {
  classifyTransaction,
  type PlaidTxnLike,
} from "../_shared/medicalClassifier.ts";
import { findReimbursementMatches } from "../_shared/depositMatcher.ts";
import Resend from "https://esm.sh/resend@2.0.0";

const allowedOrigins = [
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
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Helper function to get Plaid URL based on environment
const getPlaidUrl = (): string => {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";

  const urls: Record<string, string> = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  };

  return urls[env] || urls["sandbox"];
};

// Reclaim Phase 2: medical classification moved to ../_shared/medicalClassifier.ts
// so the webhook and this manual-sync path stay in lockstep.

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Track enough context to send a failure notification if the sync errors out
  const syncCtx: { userEmail?: string; institutionName?: string } = {};

  try {
    const requestId = crypto.randomUUID();
    // Reclaim Phase 2 W3: `is_initial` triggers the 18-month historical
    // pull driven by `HistoricalImport.tsx` right after Plaid Link. The
    // existing manual-sync path (BankAccounts.tsx) omits the flag and
    // continues to use the 30-day default window.
    const { connection_id, start_date, end_date, is_initial } =
      await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const plaidClientId = Deno.env.get("PLAID_CLIENT_ID")!;
    const plaidSecretKey = Deno.env.get("PLAID_SECRET")!;
    const plaidBaseUrl = getPlaidUrl();

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

    // Get Plaid connection
    const { data: connection, error: connectionError } = await supabase
      .from("plaid_connections")
      .select("encrypted_access_token, item_id, institution_name")
      .eq("id", connection_id)
      .eq("user_id", user.id)
      .single();

    if (connectionError || !connection) {
      console.error("Connection error:", connectionError);
      throw new Error("Connection not found");
    }
    syncCtx.institutionName = connection.institution_name;

    // Decrypt the access token
    console.log(`[${requestId}] Decrypting Plaid access token`);
    const access_token = await decryptPlaidToken(
      connection.encrypted_access_token,
    );

    // Fetch transactions from Plaid.
    // Reclaim Phase 2 W3: initial sync pulls 18 months (the midpoint of the
    // brief's 12–24 month range, §4). Subsequent syncs (manual refresh,
    // routine catch-up) keep the 30-day default to bound Plaid response size.
    const HISTORICAL_DAYS = 18 * 30; // ~540
    const DEFAULT_DAYS = 30;
    const windowDays = is_initial ? HISTORICAL_DAYS : DEFAULT_DAYS;
    const resolvedStartDate =
      start_date ||
      new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    const resolvedEndDate = end_date || new Date().toISOString().split("T")[0];
    console.log(
      `[${requestId}] Fetching transactions from ${plaidBaseUrl} (${resolvedStartDate} → ${resolvedEndDate}${is_initial ? ", initial" : ""})`,
    );
    const transactionsResponse = await fetch(
      `${plaidBaseUrl}/transactions/get`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: plaidClientId,
          secret: plaidSecretKey,
          access_token,
          start_date: resolvedStartDate,
          end_date: resolvedEndDate,
        }),
      },
    );

    const transactionsData = await transactionsResponse.json();

    if (!transactionsResponse.ok) {
      console.error("Plaid transactions error:", transactionsData);
      throw new Error(
        transactionsData.error_message || "Failed to fetch transactions",
      );
    }

    console.log(
      "Retrieved transactions:",
      transactionsData.transactions.length,
    );

    // Get user's vendor preferences for better categorization
    const { data: userPreferences } = await supabase
      .from("user_vendor_preferences")
      .select("vendor_pattern, is_medical")
      .eq("user_id", user.id);

    // Get user's invoices for matching (exclude fully paid)
    const { data: userInvoices } = await supabase
      .from("invoices")
      .select("id, vendor, amount, date, invoice_date, status")
      .eq("user_id", user.id)
      .eq("is_reimbursed", false)
      .in("status", ["unpaid", "partially_paid"]);

    // Get user's vendor aliases for smarter matching
    const { data: vendorAliases } = await supabase
      .from("vendor_aliases")
      .select("canonical_vendor, alias")
      .eq("user_id", user.id);

    // Process and store transactions. Classification uses the shared
    // module so this path agrees exactly with plaid-webhook.
    // We keep the classification result alongside each row so the
    // post-insert step (auto-link → auto-capture) can read the IRS category
    // and confidence without re-classifying.
    const classifications: Array<{
      plaid_transaction_id: string;
      reason: string;
      irsCategory?: string;
      mccCode?: string;
      needsReview: boolean;
    }> = [];
    const transactionsToInsert = await Promise.all(
      transactionsData.transactions.map(async (txn: any) => {
        const vendorName = txn.merchant_name || txn.name;
        const txnLike: PlaidTxnLike = {
          name: txn.name,
          merchant_name: txn.merchant_name,
          category: txn.category ?? null,
          mcc: txn.mcc ?? null,
        };
        const c = await classifyTransaction(
          supabase,
          txnLike,
          userPreferences ?? [],
        );
        classifications.push({
          plaid_transaction_id: txn.transaction_id,
          reason: c.reason,
          irsCategory: c.irsCategory,
          mccCode: c.mccCode,
          needsReview: c.needsReview,
        });

        return {
          user_id: user.id,
          plaid_transaction_id: txn.transaction_id,
          transaction_date: txn.date,
          vendor: vendorName,
          description: txn.name,
          amount: Math.abs(txn.amount),
          category: c.isMedical ? "medical" : txn.category?.[0] || "Other",
          is_medical: c.isMedical,
          is_hsa_eligible: c.isMedical && !c.needsReview,
          needs_review: c.needsReview,
          // Raw transactions start unlinked. Auto-link / auto-capture upgrade
          // this to 'linked_to_invoice' below. The DB check constraint
          // only allows: unlinked | linked_to_invoice | ignored.
          reconciliation_status: "unlinked",
          source: "plaid",
        };
      }),
    );

    // Insert transactions (ignore duplicates)
    if (transactionsToInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("transactions")
        .upsert(transactionsToInsert, {
          onConflict: "plaid_transaction_id",
          ignoreDuplicates: true,
        })
        .select();

      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error("Failed to store transactions");
      }

      console.log("Successfully inserted transactions:", inserted?.length || 0);

      // ── Auto-linking pipeline ─────────────────────────────────────────
      const matchStartTime = Date.now();
      let autoLinkedCount = 0;
      let suggestedCount = 0;
      let exceptionCount = 0;

      const medicalTransactions = (inserted || []).filter(
        (t: any) =>
          t.is_medical && t.reconciliation_status !== "linked_to_invoice",
      );

      if (
        medicalTransactions.length > 0 &&
        userInvoices &&
        userInvoices.length > 0
      ) {
        const aliases = vendorAliases || [];

        for (const txn of medicalTransactions) {
          const txnVendor = (txn.vendor || txn.description || "")
            .toLowerCase()
            .trim();
          let bestMatch: { invoiceId: string; confidence: number } | null =
            null;

          for (const invoice of userInvoices) {
            let confidence = 0;
            const invVendor = invoice.vendor.toLowerCase().trim();

            // Vendor match (40% weight) — check direct match, aliases, then fuzzy
            let vendorScore = 0;
            if (txnVendor === invVendor) {
              vendorScore = 1.0;
            } else if (
              txnVendor.includes(invVendor) ||
              invVendor.includes(txnVendor)
            ) {
              vendorScore = 0.8;
            } else {
              // Check aliases
              const aliasMatch = aliases.some((a) => {
                const canonical = a.canonical_vendor.toLowerCase().trim();
                const aliasText = a.alias.toLowerCase().trim();
                return (
                  (invVendor.includes(canonical) ||
                    canonical.includes(invVendor)) &&
                  (txnVendor.includes(aliasText) ||
                    aliasText.includes(txnVendor))
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

            // Date proximity (20% weight) — within 3 days for auto-link tier
            const invoiceDate = invoice.invoice_date || invoice.date;
            if (invoiceDate) {
              const txnDate = new Date(txn.transaction_date);
              const invDate = new Date(invoiceDate);
              const daysDiff = Math.abs(
                (txnDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (daysDiff <= 3) {
                confidence += 0.2;
              } else if (daysDiff <= 7) {
                confidence += 0.1;
              }
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

          // Tier 1: Auto-link (confidence >= 0.9)
          if (bestMatch.confidence >= 0.9) {
            const { error: paymentError } = await supabase
              .from("payment_transactions")
              .insert({
                invoice_id: bestMatch.invoiceId,
                transaction_id: txn.id,
                user_id: user.id,
                payment_date: txn.transaction_date,
                amount: txn.amount,
                payment_source: "out_of_pocket",
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
              // Remove invoice from candidates so it doesn't get double-linked
              const invoiceIdx = userInvoices.findIndex(
                (i) => i.id === bestMatch!.invoiceId,
              );
              if (invoiceIdx !== -1) userInvoices.splice(invoiceIdx, 1);
            } else {
              console.error(
                `[${requestId}] Auto-link failed for txn ${txn.id}:`,
                paymentError.message,
              );
              exceptionCount++;
            }
          }
          // Tier 2: Suggested match (0.7–0.9) — store suggestion, don't auto-link
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
          // Tier 3: Exception — below threshold
          else {
            exceptionCount++;
          }
        }

        console.log(
          `[${requestId}] Auto-matching: ${autoLinkedCount} auto-linked, ${suggestedCount} suggested, ${exceptionCount} exceptions`,
        );
      }

      // ── Reclaim Phase 2: auto-capture ─────────────────────────────────
      // Medical transactions that weren't auto-linked to an existing invoice
      // seed a new CAPTURED invoice and back-link the transaction. This is
      // the entry-point of the Reclaim state machine (PRODUCT_BRIEF.md §6).
      let capturedCount = 0;
      const unlinkedMedical = (inserted ?? []).filter(
        (t: any) =>
          t.is_medical && t.reconciliation_status !== "linked_to_invoice",
      );
      for (const txn of unlinkedMedical) {
        const c = classifications.find(
          (x) => x.plaid_transaction_id === txn.plaid_transaction_id,
        );
        // Reclaim Phase 2 W3: source_plaid_transaction_id participates in
        // a partial UNIQUE index so the webhook and this initial sync
        // can't race-create duplicate invoices for the same Plaid txn.
        const { data: invoice, error: invErr } = await supabase
          .from("invoices")
          .insert({
            user_id: user.id,
            vendor: txn.vendor || txn.description,
            amount: txn.amount,
            date: txn.transaction_date,
            category: c?.irsCategory || "Medical",
            is_hsa_eligible: !c?.needsReview,
            // Reclaim Phase 3: stamp the Pub 502 rule + classification
            // metadata at capture time. With a high-confidence MCC match
            // we route straight to PENDING_REVIEW; without it we leave
            // the row in CAPTURED so the user (or a future background
            // job) can run AI classification.
            lifecycle_status: c?.pub502RuleId ? "pending_review" : "captured",
            eligibility_basis_rule_id: c?.pub502RuleId ?? null,
            classification_confidence: c?.pub502RuleId ? 0.95 : null,
            classification_reasoning: c?.pub502RuleId
              ? `Auto-classified from MCC ${c.mccCode} (${c.irsCategory ?? "medical"}). Confirm during review.`
              : null,
            classified_at: c?.pub502RuleId ? new Date().toISOString() : null,
            source_plaid_transaction_id: txn.plaid_transaction_id,
            notes: c
              ? `Auto-captured from Plaid (${c.reason}${
                  c.mccCode ? ` MCC ${c.mccCode}` : ""
                }).`
              : "Auto-captured from Plaid.",
          })
          .select("id")
          .single();
        if (invErr) {
          // PostgreSQL unique_violation = 23505. When the webhook beat us
          // to it, the invoice already exists for this Plaid txn — find
          // it and link the transaction row to it rather than warning.
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
            }
            continue;
          }
          console.warn(
            `[${requestId}] Auto-capture failed for txn ${txn.id}:`,
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
        if (!updateErr) capturedCount++;
      }

      // Reclaim Phase 4 W3: deposit → Substantiation Record matching. Loop
      // over the raw Plaid txns (which preserve sign — credits are negative)
      // and surface candidates against any open records the user has.
      let depositCandidates = 0;
      for (const rawTxn of transactionsData.transactions as Array<{
        transaction_id: string;
        amount: number;
      }>) {
        if (rawTxn.amount >= 0) continue;
        const stored = (inserted ?? []).find(
          (t: any) => t.plaid_transaction_id === rawTxn.transaction_id,
        );
        if (!stored) continue;
        const { matched } = await findReimbursementMatches({
          supabase,
          userId: user.id,
          transactionRowId: stored.id,
          rawTxnAmount: rawTxn.amount,
        });
        depositCandidates += matched;
      }
      if (depositCandidates > 0) {
        console.log(
          `[${requestId}] Surfaced ${depositCandidates} reimbursement candidate(s).`,
        );
      }

      // Log matching run for observability
      await supabase.from("matching_run_log").insert({
        user_id: user.id,
        trigger_source: "plaid_sync",
        transactions_processed: medicalTransactions.length,
        auto_linked_count: autoLinkedCount,
        suggested_count: suggestedCount,
        exception_count: exceptionCount,
        duration_ms: Date.now() - matchStartTime,
      });

      // Update last sync time + record initial-sync completion when
      // applicable. The first-sync fields drive the wow-moment screen
      // (HistoricalImport.tsx) and only get written once per connection;
      // re-running an initial sync after the first one is treated as a
      // refresh and doesn't overwrite the original counts.
      const medicalDetected =
        inserted?.filter((t: any) => t.is_medical).length || 0;
      const connectionUpdate: Record<string, unknown> = {
        last_synced_at: new Date().toISOString(),
      };
      if (is_initial) {
        connectionUpdate.first_sync_completed_at = new Date().toISOString();
        connectionUpdate.initial_medical_count = medicalDetected;
        connectionUpdate.initial_total_count =
          transactionsData.transactions.length;
      }
      await supabase
        .from("plaid_connections")
        .update(connectionUpdate)
        .eq("id", connection_id);

      return new Response(
        JSON.stringify({
          success: true,
          is_initial: !!is_initial,
          total: transactionsData.transactions.length,
          inserted: inserted?.length || 0,
          medical_detected: medicalDetected,
          auto_linked: autoLinkedCount,
          suggested_matches: suggestedCount,
          captured: capturedCount,
          window_days: windowDays,
          institution_name: connection.institution_name,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Empty result branch: even with zero transactions, an initial sync
    // should still mark the connection complete so the user isn't asked
    // to wait again on retry.
    if (is_initial) {
      await supabase
        .from("plaid_connections")
        .update({
          last_synced_at: new Date().toISOString(),
          first_sync_completed_at: new Date().toISOString(),
          initial_medical_count: 0,
          initial_total_count: 0,
        })
        .eq("id", connection_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        is_initial: !!is_initial,
        total: 0,
        inserted: 0,
        medical_detected: 0,
        auto_linked: 0,
        suggested_matches: 0,
        captured: 0,
        window_days: windowDays,
        institution_name: connection.institution_name,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(
      "[plaid-sync-transactions] Error:",
      error instanceof Error ? error.message : error,
    );

    // Send sync failure notification if we know who the user is
    if (syncCtx.userEmail) {
      try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (resendKey) {
          const resend = new Resend.Resend(resendKey);
          const institution = syncCtx.institutionName || "your bank";
          await resend.emails.send({
            from: "Wellth <notifications@wellth-ai.app>",
            to: [syncCtx.userEmail],
            subject: `Action needed: ${institution} sync failed`,
            html: `
              <h2>Bank sync failed</h2>
              <p>We were unable to sync transactions from <strong>${institution}</strong>.</p>
              <p>This can happen when your bank connection needs to be refreshed. Please log in to Wellth and reconnect your bank account to restore automatic syncing.</p>
              <p>Best regards,<br>The Wellth Team</p>
            `,
          });
        }
      } catch (emailErr) {
        // Email failure should not affect the main error response
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
