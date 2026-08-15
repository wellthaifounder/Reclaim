export interface Transaction {
  id: string;
  vendor: string | null;
  amount: number;
  transaction_date: string;
  description: string;
  is_medical?: boolean | null;
  reconciliation_status?: string | null;
  category?: string | null;
  is_hsa_eligible?: boolean | null;
  notes?: string | null;
  payment_method_id?: string | null;
  invoice_id?: string | null;
}

export interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  invoice_date?: string | null;
}

export interface VendorAlias {
  canonical_vendor: string;
  alias: string;
}

export interface MatchSuggestion {
  type: "link_to_invoice" | "mark_medical" | "not_medical" | "skip";
  confidence: number;
  reason: string;
  invoice?: Invoice;
}

/** Auto-link tier thresholds */
export const MATCH_TIER = {
  /** Auto-link without user action */
  AUTO_LINK: 0.9,
  /** Show as suggested match (one-click confirm) */
  SUGGEST: 0.7,
  /** Below this = exception requiring manual resolution */
  EXCEPTION: 0.7,
} as const;

export type MatchTier = "auto_link" | "suggest" | "exception" | "no_match";

export interface TieredMatch {
  invoice: Invoice;
  confidence: number;
  tier: MatchTier;
  reason: string;
}

/**
 * Classify a confidence score into a match tier
 */
export function getMatchTier(confidence: number): MatchTier {
  if (confidence >= MATCH_TIER.AUTO_LINK) return "auto_link";
  if (confidence >= MATCH_TIER.SUGGEST) return "suggest";
  return "exception";
}

/**
 * Calculate similarity between two strings (0-1)
 */
function stringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Simple word matching
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const matches = words1.filter((w) =>
    words2.some((w2) => w2.includes(w) || w.includes(w2)),
  );

  return matches.length / Math.max(words1.length, words2.length);
}

/**
 * Check if amounts are close enough to match
 */
function amountsMatch(
  amount1: number,
  amount2: number,
  tolerance = 0.02,
): boolean {
  const diff = Math.abs(amount1 - amount2);
  const avgAmount = (amount1 + amount2) / 2;
  return diff <= avgAmount * tolerance; // 2% tolerance
}

/**
 * Check if dates are within reasonable range
 */
function datesMatch(date1: string, date2: string, daysRange = 7): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = Math.abs(
    (d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= daysRange;
}

/**
 * Check vendor match including aliases.
 * Returns 1.0 for exact/alias match, otherwise falls back to string similarity.
 */
function vendorMatchScore(
  transactionVendor: string,
  invoiceVendor: string,
  aliases: VendorAlias[] = [],
): number {
  const txnVendor = (transactionVendor || "").toLowerCase().trim();
  const invVendor = invoiceVendor.toLowerCase().trim();

  // Direct match
  if (txnVendor === invVendor) return 1.0;

  // Check aliases: does the transaction vendor match a known alias for this invoice vendor?
  for (const alias of aliases) {
    const canonical = alias.canonical_vendor.toLowerCase().trim();
    const aliasText = alias.alias.toLowerCase().trim();
    if (
      (invVendor.includes(canonical) || canonical.includes(invVendor)) &&
      (txnVendor.includes(aliasText) || aliasText.includes(txnVendor))
    ) {
      return 1.0;
    }
  }

  return stringSimilarity(txnVendor, invVendor);
}

/**
 * Find best matching invoice for a transaction
 */
export function findMatchingInvoice(
  transaction: Transaction,
  invoices: Invoice[],
  aliases: VendorAlias[] = [],
): { invoice: Invoice; confidence: number } | null {
  if (!invoices || invoices.length === 0) return null;

  let bestMatch: { invoice: Invoice; confidence: number } | null = null;

  for (const invoice of invoices) {
    let confidence = 0;

    // Check vendor similarity (with alias support)
    const vendorScore = vendorMatchScore(
      transaction.vendor || transaction.description,
      invoice.vendor,
      aliases,
    );
    confidence += vendorScore * 0.4;

    // Check amount match
    if (amountsMatch(transaction.amount, invoice.amount)) {
      confidence += 0.4;
    }

    // Check date proximity
    const invoiceDate = invoice.invoice_date || invoice.date;
    if (datesMatch(transaction.transaction_date, invoiceDate, 7)) {
      confidence += 0.2;
    }

    // Update best match if this is better
    if (confidence > 0.5 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { invoice, confidence };
    }
  }

  return bestMatch;
}

/**
 * Find best matching invoice with tier classification.
 * Used by the auto-linking pipeline.
 */
export function findTieredMatch(
  transaction: Transaction,
  invoices: Invoice[],
  aliases: VendorAlias[] = [],
): TieredMatch | null {
  const match = findMatchingInvoice(transaction, invoices, aliases);
  if (!match) return null;

  const tier = getMatchTier(match.confidence);
  const tierLabels: Record<MatchTier, string> = {
    auto_link: "Auto-linked",
    suggest: "Suggested match",
    exception: "Needs review",
    no_match: "No match",
  };

  return {
    invoice: match.invoice,
    confidence: match.confidence,
    tier,
    reason: `${tierLabels[tier]}: ${match.invoice.vendor} $${match.invoice.amount} (${Math.round(match.confidence * 100)}% confidence)`,
  };
}

/**
 * Generate smart suggestion for a transaction
 */
export function getSuggestion(
  transaction: Transaction,
  invoices: Invoice[],
  userPreferences: Array<{ vendor_pattern: string; is_medical: boolean }>,
): MatchSuggestion {
  // Check user's learned preferences first
  const vendorText = (
    transaction.vendor || transaction.description
  ).toUpperCase();
  const userPref = userPreferences.find((pref) =>
    vendorText.includes(pref.vendor_pattern.toUpperCase()),
  );

  if (userPref) {
    if (userPref.is_medical) {
      return {
        type: "mark_medical",
        confidence: 0.95,
        reason: `You previously marked ${userPref.vendor_pattern} as medical`,
      };
    } else {
      return {
        type: "not_medical",
        confidence: 0.95,
        reason: `You previously marked ${userPref.vendor_pattern} as not medical`,
      };
    }
  }

  // Try to find matching invoice
  const match = findMatchingInvoice(transaction, invoices);
  if (match && match.confidence > 0.6) {
    return {
      type: "link_to_invoice",
      confidence: match.confidence,
      reason: `Matches invoice from ${match.invoice.vendor} for $${match.invoice.amount}`,
      invoice: match.invoice,
    };
  }

  // Fall back to the server's classification. This used to re-run a
  // client-side copy of the keyword list (src/lib/medicalVendors.ts), which
  // drifted from the server's and matched unanchored substrings — so Dr Pepper
  // and Univision were suggested as healthcare providers. The row already
  // carries `is_medical` from _shared/medicalClassifier.ts; there is no reason
  // to guess again in the browser.
  if (transaction.is_medical) {
    return {
      type: "mark_medical",
      confidence: 0.8,
      reason: "Classified as a healthcare merchant during sync",
    };
  }

  // Default: suggest skipping for manual review
  return {
    type: "skip",
    confidence: 0,
    reason: "Needs manual review",
  };
}
