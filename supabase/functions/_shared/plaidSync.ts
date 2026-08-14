// Reclaim — shared cursor-based Plaid ingestion.
//
// Replaces the two independent `/transactions/get` implementations that lived
// in plaid-sync-transactions and plaid-webhook. Both had the same three bugs:
//
//   1. NO PAGINATION. `/transactions/get` was called with no `count`/`offset`,
//      so Plaid's default of 100 applied. The 540-day historical pull that the
//      caller carefully computed was silently truncated to the first 100 rows.
//   2. NO CURSOR. Date-window fetches never learn about removed or modified
//      transactions, so voided charges persisted forever and pending→posted
//      amount corrections were either ignored (`ignoreDuplicates: true` on the
//      manual path) or applied only by luck of redelivery timing.
//   3. NO ACCOUNT LINKAGE. `account_id` was dropped, making it impossible to
//      tell an HSA account from checking.
//
// `/transactions/sync` fixes all three: it is cursor-based, pages via
// `has_more`, and returns added/modified/removed as distinct sets.
//
// Scope note: this module deliberately preserves TODAY's classification and
// eligibility semantics (including writing `is_hsa_eligible` at ingest). Moving
// eligibility to the substantiation step is Workstream C and changes behavior
// the current UI depends on; keeping it out of here means Workstream A is a
// pure correctness change that can land on its own.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyTransaction,
  type ClassificationResult,
  type PlaidTxnLike,
  type UserVendorPreference,
} from "./medicalClassifier.ts";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PlaidCreds {
  clientId: string;
  secret: string;
  baseUrl: string;
}

export interface PlaidApiTransaction {
  transaction_id: string;
  account_id: string;
  name: string;
  merchant_name?: string | null;
  merchant_entity_id?: string | null;
  amount: number;
  date: string;
  pending?: boolean;
  category?: string[] | null;
  // Plaid names this `merchant_category_code`. The classifier's internal
  // contract calls it `mcc`; `mcc` is NOT a field Plaid returns — see the
  // mapping in the upsert below.
  merchant_category_code?: string | null;
  personal_finance_category?: {
    primary?: string;
    detailed?: string;
    confidence_level?: string;
  } | null;
}

export interface PlaidApiAccount {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
}

export interface SyncCounts {
  added: number;
  modified: number;
  removed: number;
  medical: number;
  pages: number;
}

/** A stored transaction row joined with the classification that produced it. */
export interface IngestedTransaction {
  id: string;
  plaid_transaction_id: string;
  plaid_account_id: string | null;
  vendor: string | null;
  description: string;
  amount: number;
  signed_amount: number;
  transaction_date: string;
  is_medical: boolean;
  invoice_id: string | null;
  reconciliation_status: string;
  classification: ClassificationResult;
}

const UPSERT_CHUNK = 250;
const PLAID_SYNC_COUNT = 500; // Plaid's maximum per page.
const MAX_PAGES = 200; // Safety valve: 100k transactions.

// ── HTTP helper ───────────────────────────────────────────────────────────

async function plaidPost<T>(
  creds: PlaidCreds,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`${creds.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...body,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(
      json?.error_message || `Plaid ${path} failed (${resp.status})`,
    );
    // Surface the code so callers can branch on pagination mutation etc.
    (err as Error & { plaidCode?: string }).plaidCode = json?.error_code;
    throw err;
  }
  return json as T;
}

// ── Accounts ──────────────────────────────────────────────────────────────

/**
 * Fetch `/accounts/get` and upsert into `plaid_accounts`.
 *
 * Returns a map of Plaid's `account_id` → our row UUID, which the transaction
 * ingest needs to populate `transactions.plaid_account_id`.
 *
 * Accounts Plaid no longer returns are marked inactive rather than deleted, so
 * historical transactions keep their linkage.
 */
export async function syncAccounts(
  supabase: SupabaseClient,
  opts: {
    connectionId: string;
    userId: string;
    accessToken: string;
    creds: PlaidCreds;
  },
): Promise<Map<string, string>> {
  const { accounts } = await plaidPost<{ accounts: PlaidApiAccount[] }>(
    opts.creds,
    "/accounts/get",
    { access_token: opts.accessToken },
  );

  const rows = (accounts ?? []).map((a) => ({
    user_id: opts.userId,
    connection_id: opts.connectionId,
    plaid_account_id: a.account_id,
    name: a.name ?? null,
    official_name: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    is_hsa_detected: isHsaAccount(a),
    is_active: true,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("plaid_accounts")
      // Do NOT touch is_hsa_override here — it is the user's correction and
      // must survive every re-sync.
      .upsert(rows, {
        onConflict: "plaid_account_id",
        ignoreDuplicates: false,
      });
    if (error)
      throw new Error(`plaid_accounts upsert failed: ${error.message}`);
  }

  const returnedIds = rows.map((r) => r.plaid_account_id);
  if (returnedIds.length > 0) {
    // PostgREST parses the `in` list itself, so values must be quoted —
    // an unquoted id containing a comma or parenthesis would silently
    // corrupt the filter and deactivate the wrong accounts.
    const quoted = returnedIds
      .map((id) => `"${String(id).replace(/"/g, '""')}"`)
      .join(",");
    await supabase
      .from("plaid_accounts")
      .update({ is_active: false })
      .eq("connection_id", opts.connectionId)
      .not("plaid_account_id", "in", `(${quoted})`);
  }

  const { data: stored, error: selErr } = await supabase
    .from("plaid_accounts")
    .select("id, plaid_account_id")
    .eq("connection_id", opts.connectionId);
  if (selErr) throw new Error(`plaid_accounts read failed: ${selErr.message}`);

  await supabase
    .from("plaid_connections")
    .update({ accounts_synced_at: new Date().toISOString() })
    .eq("id", opts.connectionId);

  return new Map((stored ?? []).map((r) => [r.plaid_account_id, r.id]));
}

/**
 * Plaid exposes HSAs as `depository`/`hsa`, but custodian coverage is uneven —
 * several surface as investment or brokerage accounts with no HSA subtype at
 * all. We detect the clear cases and let the user override the rest via
 * `plaid_accounts.is_hsa_override`.
 */
export function isHsaAccount(a: PlaidApiAccount): boolean {
  const subtype = (a.subtype ?? "").toLowerCase();
  if (subtype === "hsa") return true;
  const name = `${a.name ?? ""} ${a.official_name ?? ""}`.toLowerCase();
  return /\bhsa\b|health savings/.test(name);
}

// ── Transactions ──────────────────────────────────────────────────────────

interface SyncPage {
  added: PlaidApiTransaction[];
  modified: PlaidApiTransaction[];
  removed: Array<{ transaction_id: string }>;
  next_cursor: string;
  has_more: boolean;
}

/**
 * Drain `/transactions/sync` from the stored cursor to the present.
 *
 * Plaid's contract: keep requesting with the latest `next_cursor` while
 * `has_more` is true, and only persist the final cursor once every page has
 * been applied. Committing early would silently skip transactions if a later
 * page failed.
 *
 * If the item mutates mid-pagination Plaid returns
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION; the documented recovery is to
 * restart from the original cursor, which we do once.
 */
export async function syncTransactions(
  supabase: SupabaseClient,
  opts: {
    connectionId: string;
    userId: string;
    accessToken: string;
    creds: PlaidCreds;
    cursor: string | null;
    accountMap: Map<string, string>;
    userPreferences: UserVendorPreference[];
  },
): Promise<{ counts: SyncCounts; ingested: IngestedTransaction[] }> {
  let attempt = 0;
  while (true) {
    try {
      return await drain(supabase, opts);
    } catch (err) {
      const code = (err as Error & { plaidCode?: string }).plaidCode;
      if (
        code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        attempt === 0
      ) {
        attempt++;
        console.warn("[plaidSync] Item mutated during pagination; restarting.");
        continue;
      }
      throw err;
    }
  }
}

async function drain(
  supabase: SupabaseClient,
  opts: {
    connectionId: string;
    userId: string;
    accessToken: string;
    creds: PlaidCreds;
    cursor: string | null;
    accountMap: Map<string, string>;
    userPreferences: UserVendorPreference[];
  },
): Promise<{ counts: SyncCounts; ingested: IngestedTransaction[] }> {
  const added: PlaidApiTransaction[] = [];
  const modified: PlaidApiTransaction[] = [];
  const removedIds: string[] = [];

  let cursor = opts.cursor;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    if (++pages > MAX_PAGES) {
      console.warn(`[plaidSync] Hit MAX_PAGES (${MAX_PAGES}); stopping early.`);
      break;
    }
    const page = await plaidPost<SyncPage>(opts.creds, "/transactions/sync", {
      access_token: opts.accessToken,
      // Plaid rejects an explicit null cursor — omit it entirely on first sync
      // to request from the beginning of available history.
      ...(cursor ? { cursor } : {}),
      count: PLAID_SYNC_COUNT,
      options: {
        include_personal_finance_category: true,
      },
    });

    added.push(...(page.added ?? []));
    modified.push(...(page.modified ?? []));
    removedIds.push(...(page.removed ?? []).map((r) => r.transaction_id));

    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  // ── Apply removals first ────────────────────────────────────────────────
  // A removed Plaid transaction is one that never actually posted (a dropped
  // pending authorization) or was reversed. Leaving it behind is what made
  // stale rows accumulate under the old date-window implementation.
  //
  // Removing the transaction alone is not enough: medical transactions are
  // auto-captured into an invoice, and `transactions.invoice_id` is the child
  // side of that relationship. Deleting only the transaction would strand a
  // phantom expense that the user never incurred — worse than the stale row we
  // are fixing. So we clean up the auto-captured invoice too, but ONLY when it
  // is untouched: still in an early lifecycle state, carrying no receipts, and
  // never submitted. Anything the user has worked on is preserved and logged
  // for them to resolve, and anything already in a substantiation record is
  // protected by that table's ON DELETE RESTRICT regardless.
  if (removedIds.length > 0) {
    for (const chunk of chunked(removedIds, UPSERT_CHUNK)) {
      const { data: orphanCandidates } = await supabase
        .from("invoices")
        .select("id, lifecycle_status, source_plaid_transaction_id")
        .eq("user_id", opts.userId)
        .in("source_plaid_transaction_id", chunk)
        .in("lifecycle_status", ["captured", "pending_review"]);

      const candidateIds = (orphanCandidates ?? []).map((i) => i.id);

      if (candidateIds.length > 0) {
        // Exclude any that have documentation attached — the presence of a
        // receipt means the user engaged with it.
        const { data: withReceipts } = await supabase
          .from("receipts")
          .select("invoice_id")
          .in("invoice_id", candidateIds);
        const keep = new Set(
          (withReceipts ?? []).map((r) => r.invoice_id as string),
        );
        const deletable = candidateIds.filter((id) => !keep.has(id));

        if (deletable.length > 0) {
          const { error: invDelErr } = await supabase
            .from("invoices")
            .delete()
            .eq("user_id", opts.userId)
            .in("id", deletable);
          if (invDelErr) {
            console.warn(
              `[plaidSync] Orphan invoice cleanup failed: ${invDelErr.message}`,
            );
          }
        }
        if (keep.size > 0) {
          console.log(
            `[plaidSync] ${keep.size} auto-captured expense(s) kept despite Plaid removal — they have receipts attached.`,
          );
        }
      }

      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("user_id", opts.userId)
        .in("plaid_transaction_id", chunk);
      if (error) {
        console.warn(`[plaidSync] Removal delete failed: ${error.message}`);
      }
    }
  }

  // ── Classify + upsert added and modified ────────────────────────────────
  // `modified` must overwrite (ignoreDuplicates: false) — that is the whole
  // point of processing it. The old manual-sync path used
  // ignoreDuplicates: true, so pending→posted amount changes never landed.
  const inbound = [...added, ...modified];
  const ingested: IngestedTransaction[] = [];
  let medical = 0;

  for (const chunk of chunked(inbound, UPSERT_CHUNK)) {
    const classifications = new Map<string, ClassificationResult>();
    const rows = [];

    for (const txn of chunk) {
      const txnLike: PlaidTxnLike = {
        name: txn.name,
        merchant_name: txn.merchant_name,
        category: txn.category ?? null,
        // Plaid returns `merchant_category_code`; there is no `mcc` field on
        // the transaction object. Both ingest paths previously read `txn.mcc`,
        // which was always undefined, so the classifier's MCC tier never fired
        // and every transaction fell through to the keyword/category tiers —
        // which always set needsReview, flooding the review queue and leaving
        // the mcc_codes table and its Pub 502 rule mapping entirely unused.
        // Verified against the Plaid sandbox 2026-08-14: 'mcc' in txn === false,
        // merchant_category_code populated on 10 of 16 transactions.
        mcc: txn.merchant_category_code ?? null,
        // Plaid's v2 taxonomy, present on every transaction in the sandbox run
        // (16/16) versus 60% for MCC — the classifier's most reliable signal,
        // and the source of the transfer/loan-payment exclusions.
        personal_finance_category: txn.personal_finance_category ?? null,
      };
      const c = await classifyTransaction(
        supabase,
        txnLike,
        opts.userPreferences,
      );
      classifications.set(txn.transaction_id, c);
      if (c.isMedical) medical++;

      rows.push({
        user_id: opts.userId,
        plaid_transaction_id: txn.transaction_id,
        plaid_account_id: opts.accountMap.get(txn.account_id) ?? null,
        transaction_date: txn.date,
        vendor: txn.merchant_name || txn.name,
        description: txn.name,
        // `amount` stays absolute for existing consumers; `signed_amount`
        // preserves Plaid's convention (positive = money out) so credit
        // detection and transfer matching can run against stored rows.
        amount: Math.abs(txn.amount),
        signed_amount: txn.amount,
        category: c.isMedical ? "medical" : (txn.category?.[0] ?? "Other"),
        is_medical: c.isMedical,
        is_hsa_eligible: c.isMedical && !c.needsReview,
        needs_review: c.needsReview,
        reconciliation_status: "unlinked",
        source: "plaid",
      });
    }

    const { data: upserted, error } = await supabase
      .from("transactions")
      .upsert(rows, {
        onConflict: "plaid_transaction_id",
        ignoreDuplicates: false,
      })
      .select(
        "id, plaid_transaction_id, plaid_account_id, vendor, description, amount, signed_amount, transaction_date, is_medical, invoice_id, reconciliation_status",
      );

    if (error) {
      throw new Error(`transactions upsert failed: ${error.message}`);
    }

    for (const row of upserted ?? []) {
      const c = classifications.get(row.plaid_transaction_id);
      if (!c) continue;
      ingested.push({ ...row, classification: c } as IngestedTransaction);
    }
  }

  // ── Commit the cursor only after every page applied cleanly ─────────────
  if (cursor) {
    const { error } = await supabase
      .from("plaid_connections")
      .update({
        transactions_cursor: cursor,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", opts.connectionId);
    if (error) {
      console.error(`[plaidSync] Cursor commit failed: ${error.message}`);
    }
  }

  return {
    counts: {
      added: added.length,
      modified: modified.length,
      removed: removedIds.length,
      medical,
      pages,
    },
    ingested,
  };
}

// ── Institution display name ──────────────────────────────────────────────

/**
 * `plaid_connections.institution_name` had been storing Plaid's raw
 * institution_id, so users saw strings like `ins_109508`. Resolve the real
 * display name; fall back to the id rather than failing the sync.
 */
export async function resolveInstitutionName(
  creds: PlaidCreds,
  institutionId: string,
): Promise<string> {
  try {
    const data = await plaidPost<{ institution?: { name?: string } }>(
      creds,
      "/institutions/get_by_id",
      {
        institution_id: institutionId,
        country_codes: ["US"],
      },
    );
    return data.institution?.name || institutionId;
  } catch (err) {
    console.warn(
      "[plaidSync] Institution lookup failed:",
      err instanceof Error ? err.message : err,
    );
    return institutionId;
  }
}

// ── utils ─────────────────────────────────────────────────────────────────

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}
