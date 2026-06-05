// Reclaim — shared medical-transaction classifier
//
// Used by both plaid-sync-transactions (manual sync, called from the client
// with a user JWT) and plaid-webhook (server-to-server, Plaid-signed). Keeping
// the classification logic here ensures the two paths stay in lockstep — no
// drift between webhook-classified transactions and manually synced ones.
//
// Classification tiers (highest to lowest confidence):
//   1. User preference  → confirmed by the user previously, no review needed
//   2. MCC match        → IRS-aligned merchant category, high-confidence auto
//   3. Plaid category   → coarse signal ("Healthcare" array), needs review
//   4. Keyword match    → vendor name contains a known medical term, needs review

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PlaidTxnLike {
  name: string;
  merchant_name?: string | null;
  category?: string[] | null;
  // Plaid raw MCC. Available on `transactions/get` and `transactions/sync`
  // when the issuing bank exposes it. May be undefined for older items.
  mcc?: string | null;
}

export interface UserVendorPreference {
  vendor_pattern: string;
  is_medical: boolean;
}

export interface ClassificationResult {
  isMedical: boolean;
  needsReview: boolean;
  reason: "mcc" | "user_preference" | "category" | "keyword" | "none";
  mccCode?: string;
  irsCategory?: string;
  // Reclaim Phase 3: when classification source is "mcc", the matching MCC's
  // default_pub_502_rule_id is returned so the caller can stamp it on the
  // captured invoice without a separate DB roundtrip. Other classification
  // sources leave this unset; classify-expense (AI) fills it in later if
  // the user runs explicit AI classification.
  pub502RuleId?: string;
  confidence: number;
}

// ── Static keywords (legacy fallback) ──────────────────────────────────────
// These move forward verbatim from the original plaid-sync-transactions
// implementation. They're a coarse fallback for transactions Plaid doesn't
// tag with an MCC. Edit with care — false positives flood the review queue.
export const MEDICAL_KEYWORDS: readonly string[] = [
  // Pharmacies
  "cvs",
  "walgreens",
  "rite aid",
  "walmart pharmacy",
  "kroger pharmacy",
  "costco pharmacy",
  "target pharmacy",
  "publix pharmacy",
  "safeway pharmacy",
  // Healthcare systems
  "kaiser",
  "sutter",
  "dignity health",
  "adventist health",
  "scripps",
  "sharp",
  "hoag",
  "cedars-sinai",
  "ucla health",
  "stanford health",
  // Labs
  "quest diagnostics",
  "labcorp",
  "biomat",
  "grifols",
  // Vision
  "visionworks",
  "lenscrafters",
  "pearle vision",
  "eyeglass world",
  // Dental
  "aspen dental",
  "gentle dental",
  "bright now dental",
  // Medical supplies / HSA stores
  "medline",
  "fsa store",
  "hsa store",
  "direct medical",
  // Telehealth
  "teladoc",
  "doctor on demand",
  "amwell",
  "mdlive",
  // Mental health
  "talkspace",
  "betterhelp",
  "cerebral",
  "headspace care",
  // Common terms
  "pharmacy",
  "medical",
  "hospital",
  "clinic",
  "doctor",
  "dentist",
  "dental",
  "orthodont",
  "vision",
  "optometry",
  "physical therapy",
  "urgent care",
  "lab",
  "radiology",
  "imaging",
  "prescription",
  "rx",
  "health",
  "blue cross",
  "aetna",
  "cigna",
  "united health",
  "humana",
  "dr ",
  "dds",
  "dmd",
  "chiropractic",
  "pediatric",
  "dermatology",
  "cardiology",
  "orthopedic",
];

export const MEDICAL_PLAID_CATEGORIES: readonly string[] = [
  "healthcare",
  "pharmacy",
  "medical",
  "dentist",
  "optometrist",
  "healthcare services",
  "pharmacies",
  "medical services",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function matchesKeyword(haystack: string): boolean {
  return MEDICAL_KEYWORDS.some((k) => haystack.includes(k));
}

function matchesPlaidCategory(categoryText: string): boolean {
  return MEDICAL_PLAID_CATEGORIES.some((c) => categoryText.includes(c));
}

// ── MCC lookup ─────────────────────────────────────────────────────────────
// Cache the medical MCC set in-memory for the lifetime of the Deno worker —
// the table is tiny and changes only via migration, so a single cache miss
// per cold start is plenty.
let mccCacheLoaded = false;
let mccCache: Map<
  string,
  { irsCategory: string | null; pub502RuleId: string | null }
> = new Map();

async function loadMccCache(supabase: SupabaseClient): Promise<void> {
  if (mccCacheLoaded) return;
  const { data, error } = await supabase
    .from("mcc_codes")
    .select("code, irs_category, default_pub_502_rule_id")
    .eq("is_medical", true);
  if (error) {
    console.warn(
      "[medicalClassifier] MCC cache load failed; falling back to keyword-only.",
      error.message,
    );
    mccCacheLoaded = true;
    return;
  }
  mccCache = new Map(
    (data ?? []).map((r) => [
      r.code,
      {
        irsCategory: r.irs_category,
        pub502RuleId: r.default_pub_502_rule_id ?? null,
      },
    ]),
  );
  mccCacheLoaded = true;
}

/** Reset the in-memory MCC cache. Useful only in tests. */
export function _resetMccCacheForTests(): void {
  mccCacheLoaded = false;
  mccCache = new Map();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Classify a single Plaid transaction. The caller must pass a Supabase client
 * that has read access to `mcc_codes` (anon or service-role both work — RLS
 * permits SELECT to authenticated and the service role bypasses RLS).
 */
export async function classifyTransaction(
  supabase: SupabaseClient,
  txn: PlaidTxnLike,
  userPreferences: UserVendorPreference[] = [],
): Promise<ClassificationResult> {
  const vendor = (txn.merchant_name || txn.name || "").toLowerCase().trim();
  const categoryText = (txn.category ?? []).join(" ").toLowerCase();

  // Tier 1: user preference is authoritative
  const pref = userPreferences.find((p) =>
    vendor.includes(p.vendor_pattern.toLowerCase()),
  );
  if (pref) {
    return {
      isMedical: pref.is_medical,
      needsReview: false,
      reason: "user_preference",
      confidence: 1.0,
    };
  }

  // Tier 2: MCC match (IRS-aligned, no user review required)
  if (txn.mcc) {
    await loadMccCache(supabase);
    const hit = mccCache.get(txn.mcc);
    if (hit) {
      return {
        isMedical: true,
        needsReview: false,
        reason: "mcc",
        mccCode: txn.mcc,
        irsCategory: hit.irsCategory ?? undefined,
        pub502RuleId: hit.pub502RuleId ?? undefined,
        confidence: 0.95,
      };
    }
  }

  // Tier 3: Plaid category (coarse, needs review)
  if (matchesPlaidCategory(categoryText)) {
    return {
      isMedical: true,
      needsReview: true,
      reason: "category",
      confidence: 0.7,
    };
  }

  // Tier 4: keyword match in vendor name (needs review)
  if (matchesKeyword(vendor)) {
    return {
      isMedical: true,
      needsReview: true,
      reason: "keyword",
      confidence: 0.6,
    };
  }

  return {
    isMedical: false,
    needsReview: false,
    reason: "none",
    confidence: 1.0,
  };
}
