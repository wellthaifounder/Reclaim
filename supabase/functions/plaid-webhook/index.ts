// Reclaim — Plaid webhook receiver.
//
// Receives Plaid TRANSACTIONS webhooks and ingests via the shared cursor-based
// pipeline in ../_shared/plaidSync.ts.
//
// Rewritten 2026-08-12 for the bank-sync rebuild. Previously this handler
// fetched a hardcoded 30-day window from /transactions/get regardless of
// webhook_code, which meant HISTORICAL_UPDATE — the event that exists
// specifically to announce that back-history is ready — never pulled more than
// 30 days. It also had its own copy of the auto-capture logic, which had
// already drifted from the manual-sync copy. Both problems are gone: the
// cursor decides what to fetch, and capture is shared.
//
// Security model:
//   - SERVER-TO-SERVER endpoint. Plaid is the caller; no end-user JWT exists.
//     The canonical edge-function checklist's user-auth step is replaced by
//     Plaid's JWT-signed webhook verification (../_shared/plaidWebhookVerification.ts).
//   - Uses SERVICE_ROLE_KEY because it writes across many users' rows on
//     Plaid's behalf. Every write is scoped by the resolved
//     plaid_connections.user_id — the webhook body's contents are never
//     trusted to identify a user.
//   - Replies 200 on body-level errors after verification so Plaid does not
//     retry indefinitely on a logic bug. Verification failure returns 401.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPlaidToken } from "../_shared/encryption.ts";
import {
  autoCaptureExpenses,
  detectDuplicates,
  detectTransfers,
  matchDeposits,
} from "../_shared/autoCapture.ts";
import {
  syncAccounts,
  syncTransactions,
  type PlaidCreds,
} from "../_shared/plaidSync.ts";
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

  const creds: PlaidCreds = {
    clientId: plaidClientId,
    secret: plaidSecret,
    baseUrl: plaidBaseUrl(),
  };

  try {
    // Only TRANSACTIONS webhooks trigger ingestion. Others (ITEM, AUTH, …) are
    // acked with a 200 so Plaid doesn't retry, and logged for later wiring.
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

    console.log(
      "[plaid-webhook] TRANSACTIONS",
      payload.webhook_code,
      "item_id=",
      payload.item_id,
      "new=",
      payload.new_transactions ?? 0,
    );

    // ── 3. Resolve the connection (and therefore the user) from item_id ─
    const { data: connection, error: connErr } = await supabase
      .from("plaid_connections")
      .select(
        "id, user_id, encrypted_access_token, institution_name, transactions_cursor",
      )
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

    // ── 4. Refresh accounts, then ingest from the cursor ────────────────
    // No date window and no per-webhook_code branching: /transactions/sync
    // returns exactly what has changed since our last successful sync,
    // whichever event woke us up.
    const accountMap = await syncAccounts(supabase, {
      connectionId: connection.id,
      userId: connection.user_id,
      accessToken,
      creds,
    });

    // Workstream C3: categorization_rules replaces user_vendor_preferences.
    const { data: rules } = await supabase
      .from("categorization_rules")
      .select("id, match_type, match_value, is_medical, display_label")
      .eq("user_id", connection.user_id);

    const { counts, ingested } = await syncTransactions(supabase, {
      connectionId: connection.id,
      userId: connection.user_id,
      accessToken,
      creds,
      cursor: connection.transactions_cursor,
      accountMap,
      rules: rules ?? [],
    });

    // ── 4b. Transfer detection (Workstream C5), before capture so a card
    // payment never becomes a phantom expense.
    const transferPairs = await detectTransfers(supabase, {
      userId: connection.user_id,
    });

    // ── 5. Capture + deposit matching (shared with plaid-sync-transactions)
    const captured = await autoCaptureExpenses(supabase, {
      userId: connection.user_id,
      ingested,
    });
    const depositCandidates = await matchDeposits(supabase, {
      userId: connection.user_id,
      ingested,
    });

    // ── 5b. Duplicate detection (Workstream C6), after capture — the expense
    // just created is one half of every pair worth finding.
    const duplicates = await detectDuplicates(supabase, {
      userId: connection.user_id,
    });

    console.log(
      `[plaid-webhook] +${counts.added} ~${counts.modified} -${counts.removed} across ${counts.pages} page(s); transfers ${transferPairs}, captured ${captured}, deposit candidates ${depositCandidates}, duplicate candidates ${duplicates}`,
    );

    return new Response(
      JSON.stringify({
        received: true,
        added: counts.added,
        modified: counts.modified,
        removed: counts.removed,
        captured,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    // Always ack 200 after verification has succeeded: Plaid retries on 5xx for
    // up to 24h, and a logic bug should surface through logs, not a retry storm.
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
