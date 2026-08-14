// Reclaim — shared medical-transaction classifier.
//
// Used by plaid-sync-transactions and plaid-webhook via _shared/plaidSync.ts.
// One implementation so the two ingest paths cannot drift.
//
// Rewritten 2026-08-14 (Workstream C1). Three things were wrong:
//
//   1. The MCC tier never fired. Callers read `txn.mcc`, but Plaid has no such
//      field — it is `merchant_category_code`. Every transaction therefore fell
//      through to the category or keyword tier, both of which set needsReview,
//      so EVERY medical transaction landed in the review queue and the
//      mcc_codes table was dead code. Fixed in plaidSync.ts; this module now
//      documents the contract explicitly.
//   2. Keywords matched as unanchored substrings. "lab", "rx", "health",
//      "sharp", "dr " and friends flag Dr Pepper, Sharp Electronics, Univision
//      and anything containing "collab".
//   3. Nothing was ever excluded. A credit-card payment to a card used at a
//      pharmacy, an HSA transfer, and a vet bill were all classification
//      candidates.
//
// Tier order (first match wins):
//   1. User preference   — the user has ruled on this vendor; authoritative
//   2. Hard exclusion    — transfers, loan payments, veterinary care
//   3. MCC               — IRS-aligned merchant category, high confidence
//   4. Personal finance category — Plaid's v2 taxonomy, confidence-gated
//   5. Keyword           — curated, word-boundary anchored
//
// Scope note: this decides MEDICAL vs NOT MEDICAL only. HSA *eligibility* is
// resolved later, at substantiation, where date of service, patient and Pub 502
// category are known. See .claude/plans/bank-sync-workflow-spec.md.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PlaidPersonalFinanceCategory {
  primary?: string | null;
  detailed?: string | null;
  confidence_level?: string | null;
}

export interface PlaidTxnLike {
  name: string;
  merchant_name?: string | null;
  /** Legacy Plaid `category[]`. Superseded by personal_finance_category. */
  category?: string[] | null;
  /**
   * Raw MCC. NOTE: Plaid does not return a field called `mcc` — it is
   * `merchant_category_code` on the transaction object. Callers must map it;
   * reading `txn.mcc` off a Plaid transaction yields undefined and silently
   * disables the MCC tier. Verified against the sandbox 2026-08-14: populated
   * on roughly 60% of transactions.
   */
  mcc?: string | null;
  personal_finance_category?: PlaidPersonalFinanceCategory | null;
}

export interface UserVendorPreference {
  vendor_pattern: string;
  is_medical: boolean;
}

export type ClassificationReason =
  | "user_preference"
  | "excluded"
  | "mcc"
  | "personal_finance_category"
  | "keyword"
  | "none";

export interface ClassificationResult {
  isMedical: boolean;
  needsReview: boolean;
  reason: ClassificationReason;
  mccCode?: string;
  irsCategory?: string;
  /**
   * When the source is "mcc", the matching code's default_pub_502_rule_id, so
   * the caller can stamp it on the captured expense without a second query.
   */
  pub502RuleId?: string;
  confidence: number;
  /** Plain-language justification. Surfaced in the UI as the "why" chip. */
  explanation: string;
}

// ── Hard exclusions ───────────────────────────────────────────────────────
// Plaid personal_finance_category.primary values that can never be a medical
// expense, whatever the merchant name says. Without these, paying off a credit
// card used at a pharmacy classifies as medical, and so does moving money into
// an HSA.
const EXCLUDED_PFC_PRIMARY: ReadonlySet<string> = new Set([
  "LOAN_PAYMENTS",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "BANK_FEES",
  "INCOME",
]);

// Veterinary care sits under Plaid's MEDICAL primary but is not a qualified
// medical expense — IRS Pub 502 covers care for people, not pets. Service
// animals are the exception, which is exactly why user preference (tier 1)
// outranks this exclusion.
const EXCLUDED_PFC_DETAILED: ReadonlySet<string> = new Set([
  "MEDICAL_VETERINARY_SERVICES",
]);

// ── Plaid personal_finance_category (v2) ──────────────────────────────────
const MEDICAL_PFC_DETAILED: ReadonlySet<string> = new Set([
  "MEDICAL_DENTAL_CARE",
  "MEDICAL_EYE_CARE",
  "MEDICAL_NURSING_CARE",
  "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
  "MEDICAL_PRIMARY_CARE",
  "MEDICAL_OTHER_MEDICAL",
]);

/** Plaid confidence levels we trust without asking the user. */
const TRUSTED_PFC_CONFIDENCE: ReadonlySet<string> = new Set([
  "VERY_HIGH",
  "HIGH",
]);

// ── Keywords ──────────────────────────────────────────────────────────────
// Split by reliability. Brands are distinctive enough to accept outright;
// generic terms are real signal but ambiguous, so they route to review.
//
// Deliberately NOT present, and why:
//   "lab"    — matches "The Lab Kitchen"; use "labcorp"/"laboratory" instead
//   "dr "    — matches "DR PEPPER"
//   "sharp"  — matches "Sharp Electronics"; use "sharp healthcare"
//   "rx"     — too short to anchor usefully against real merchant strings
// Every term below is matched on word boundaries, never as a bare substring.

export const MEDICAL_BRANDS: readonly string[] = [
  // Pharmacies
  "cvs",
  "walgreens",
  "rite aid",
  "duane reade",
  // Health systems
  "kaiser",
  "sutter health",
  "dignity health",
  "adventist health",
  "scripps",
  "sharp healthcare",
  "hoag",
  "cedars-sinai",
  "ucla health",
  "stanford health",
  "mayo clinic",
  "cleveland clinic",
  // Labs & imaging
  "labcorp",
  "lab corp",
  "quest diagnostics",
  "biomat",
  "grifols",
  // Vision
  "visionworks",
  "lenscrafters",
  "pearle vision",
  "eyeglass world",
  "warby parker",
  "1-800 contacts",
  // Dental
  "aspen dental",
  "gentle dental",
  "bright now dental",
  "smile direct",
  // Supplies
  "medline",
  "fsa store",
  "hsa store",
  "direct medical",
  // Telehealth
  "teladoc",
  "doctor on demand",
  "amwell",
  "mdlive",
  "sesame care",
  // Mental health
  "talkspace",
  "betterhelp",
  "cerebral",
  "headspace care",
];

export const MEDICAL_TERMS: readonly string[] = [
  "pharmacy",
  "pharmacies",
  "medical",
  "medicine",
  "hospital",
  "clinic",
  "doctor",
  "physician",
  "dentist",
  "dental",
  "orthodontic",
  "orthodontics",
  "vision",
  "optometry",
  "optometrist",
  "ophthalmology",
  "optical",
  "physical therapy",
  "physiotherapy",
  "urgent care",
  "laboratory",
  "radiology",
  "imaging",
  "prescription",
  "pediatric",
  "pediatrics",
  "dermatology",
  "cardiology",
  "orthopedic",
  "orthopedics",
  "chiropractic",
  "surgery",
  "surgical",
  "anesthesia",
  "oncology",
  "obstetrics",
  "gynecology",
  "psychiatry",
  "psychology",
  "therapist",
  "wellness clinic",
  "health center",
  "healthcare",
  "health system",
  "family practice",
  "dds",
  "dmd",
];

// ── Matching helpers ──────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build one alternation regex per list, anchored on word boundaries.
 *
 * `\b` is what stops "vision" matching "Univision" and "lab" matching
 * "collab" — there is no word boundary between two word characters. Compiled
 * once at module load; these run against every transaction.
 */
function buildMatcher(terms: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${terms.map(escapeRegex).join("|")})\\b`, "i");
}

const BRAND_RE = buildMatcher(MEDICAL_BRANDS);
const TERM_RE = buildMatcher(MEDICAL_TERMS);

function firstMatch(re: RegExp, haystack: string): string | null {
  const m = re.exec(haystack);
  return m ? m[0] : null;
}

/**
 * Match a user's saved vendor pattern on a word boundary rather than as a bare
 * substring, and prefer the longest pattern when several apply — so a specific
 * rule beats a generic one instead of whichever happened to be first.
 */
function matchUserPreference(
  vendor: string,
  prefs: UserVendorPreference[],
): UserVendorPreference | null {
  let best: UserVendorPreference | null = null;
  for (const p of prefs) {
    const pattern = (p.vendor_pattern ?? "").trim();
    if (!pattern) continue;
    const re = new RegExp(`\\b${escapeRegex(pattern)}`, "i");
    if (
      re.test(vendor) &&
      (!best || pattern.length > best.vendor_pattern.trim().length)
    ) {
      best = p;
    }
  }
  return best;
}

// ── MCC lookup ────────────────────────────────────────────────────────────
// Cached for the lifetime of the Deno worker; the table is small and changes
// only by migration, so one miss per cold start is fine.
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
      "[medicalClassifier] MCC cache load failed; continuing without the MCC tier.",
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

/** Reset the in-memory MCC cache. Tests only. */
export function _resetMccCacheForTests(): void {
  mccCacheLoaded = false;
  mccCache = new Map();
}

// ── Public API ────────────────────────────────────────────────────────────

export async function classifyTransaction(
  supabase: SupabaseClient,
  txn: PlaidTxnLike,
  userPreferences: UserVendorPreference[] = [],
): Promise<ClassificationResult> {
  const vendor = (txn.merchant_name || txn.name || "").trim();
  const pfc = txn.personal_finance_category ?? null;
  const detailed = (pfc?.detailed ?? "").toUpperCase();
  const primary = (pfc?.primary ?? "").toUpperCase();

  // Tier 1 — the user has already ruled on this vendor.
  const pref = matchUserPreference(vendor, userPreferences);
  if (pref) {
    return {
      isMedical: pref.is_medical,
      needsReview: false,
      reason: "user_preference",
      confidence: 1.0,
      explanation: `You previously marked "${pref.vendor_pattern}" as ${
        pref.is_medical ? "medical" : "not medical"
      }.`,
    };
  }

  // Tier 2 — hard exclusions.
  if (EXCLUDED_PFC_PRIMARY.has(primary)) {
    return {
      isMedical: false,
      needsReview: false,
      reason: "excluded",
      confidence: 0.95,
      explanation: `Categorized as ${primary
        .toLowerCase()
        .replace(
          /_/g,
          " ",
        )}, which is a money movement rather than a purchase.`,
    };
  }
  if (EXCLUDED_PFC_DETAILED.has(detailed)) {
    return {
      isMedical: false,
      needsReview: false,
      reason: "excluded",
      confidence: 0.9,
      explanation:
        "Veterinary care. Pub 502 covers care for people, not pets — mark it medical if this was for a service animal.",
    };
  }

  // Tier 3 — MCC.
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
        explanation: `Merchant category code ${txn.mcc}${
          hit.irsCategory ? ` (${hit.irsCategory})` : ""
        } is a medical category.`,
      };
    }
  }

  // Tier 4 — Plaid's personal finance category.
  if (MEDICAL_PFC_DETAILED.has(detailed)) {
    const conf = (pfc?.confidence_level ?? "").toUpperCase();
    const trusted = TRUSTED_PFC_CONFIDENCE.has(conf);
    const label = detailed.toLowerCase().replace(/_/g, " ");
    return {
      isMedical: true,
      needsReview: !trusted,
      reason: "personal_finance_category",
      confidence: trusted ? 0.9 : 0.65,
      explanation: trusted
        ? `Plaid categorized this as ${label}.`
        : `Plaid categorized this as ${label}, but with ${
            conf.toLowerCase() || "unknown"
          } confidence — worth a look.`,
    };
  }

  // Tier 5 — keywords.
  const brand = firstMatch(BRAND_RE, vendor);
  if (brand) {
    return {
      isMedical: true,
      needsReview: false,
      reason: "keyword",
      confidence: 0.85,
      explanation: `"${brand}" is a known healthcare merchant.`,
    };
  }
  const term = firstMatch(TERM_RE, vendor);
  if (term) {
    return {
      isMedical: true,
      needsReview: true,
      reason: "keyword",
      confidence: 0.6,
      explanation: `Merchant name contains "${term}" — confirm this was a medical expense.`,
    };
  }

  return {
    isMedical: false,
    needsReview: false,
    reason: "none",
    confidence: 0.9,
    explanation: "No medical signal in the merchant name or category.",
  };
}
