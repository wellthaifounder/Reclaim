// Merchant-descriptor normalization — browser copy.
//
// This is the third of three copies that MUST agree byte for byte:
//
//   1. public.normalize_merchant_name / transaction_matches_rule (SQL) —
//      retroactive apply (20260815120000_categorization_rules.sql, operators
//      added in 20260915210000_rule_name_match_operators.sql)
//   2. supabase/functions/_shared/categorizationRules.ts (Deno) — apply at ingest
//   3. this file (browser) — rule creation and preview
//
// They are duplicated rather than shared because Postgres, Deno and the Vite
// bundle cannot import from one another. If you change one, change all three;
// a divergence means the "apply to N past transactions" count in the UI stops
// matching the number of rows the database actually updates.
//
// Pinned by supabase/functions/_shared/categorizationRules.test.ts.

export type RuleMatchType = "merchant_entity" | "mcc" | "name_pattern";

/** Precedence order. Lower wins. */
export const MATCH_TYPE_PRECEDENCE: Record<RuleMatchType, number> = {
  merchant_entity: 1,
  mcc: 2,
  name_pattern: 3,
};

export const MATCH_TYPE_LABELS: Record<RuleMatchType, string> = {
  merchant_entity: "Exact merchant",
  mcc: "Merchant category",
  name_pattern: "Merchant name",
};

// docs/TRANSACTION_REVIEW_SPEC.md D22. Only name_pattern rules read this —
// entity and mcc rules always match on exact equality of that one signal.
export type RuleMatchOperator = "is_exactly" | "starts_with" | "contains";

/** Specificity order for findGoverningRule's tie-break. Lower wins. */
export const MATCH_OPERATOR_SPECIFICITY: Record<RuleMatchOperator, number> = {
  is_exactly: 1,
  starts_with: 2,
  contains: 3,
};

export const MATCH_OPERATOR_LABELS: Record<RuleMatchOperator, string> = {
  is_exactly: "Is exactly",
  starts_with: "Starts with",
  contains: "Contains",
};

/**
 * Normalize a merchant descriptor to a stable comparison key.
 *
 * Order matters: strip the processor prefix, then the trailing store number,
 * then collapse everything else. "SQ *WALGREENS 991" and "WALGREENS #4821"
 * both become "walgreens".
 */
export function normalizeMerchantName(name: string | null): string | null {
  const normalized = (name ?? "")
    .toLowerCase()
    .replace(/^(sq|tst|sp|pp|paypal|pos|ach|dd|ext|py|chk)\s*\*+\s*/, "")
    .replace(/\s*[#*]?\s*\d{3,}\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized === "" ? null : normalized;
}

/** Minimal rule shape needed for matching. */
export interface MatchableRule {
  id: string;
  match_type: RuleMatchType;
  match_value: string;
  is_medical: boolean;
  display_label?: string | null;
  /** Only consulted for match_type 'name_pattern'. Defaults to 'starts_with'
   *  — today's only behaviour — for callers that predate this field. */
  match_operator?: RuleMatchOperator;
}

export interface RuleMatchInput {
  merchant_entity_id?: string | null;
  merchant_category_code?: string | null;
  vendor?: string | null;
  description?: string | null;
}

/**
 * Does this rule match this transaction? Mirrors transaction_matches_rule.
 *
 * D22's three operators, for a name_pattern rule: is_exactly (equal, full
 * stop), starts_with (a word-boundary prefix — the original, still default,
 * behaviour), and contains (a raw substring, no boundary — the one that can
 * reach a healthcare billing middleman like `ATHENAHEALTH*SMITH FAMILY MED`,
 * at the cost of also being the one that can catch Mediterranean Grill on a
 * rule meant for "med" — see suggestRuleKey's caller for the D23 preview
 * that's meant to warn about exactly that before it's saved).
 */
export function ruleMatches(
  rule: MatchableRule,
  input: RuleMatchInput,
): boolean {
  switch (rule.match_type) {
    case "merchant_entity":
      return (
        !!input.merchant_entity_id &&
        input.merchant_entity_id === rule.match_value
      );
    case "mcc":
      return (
        !!input.merchant_category_code &&
        input.merchant_category_code === rule.match_value
      );
    case "name_pattern": {
      const normalized = normalizeMerchantName(
        input.vendor ?? input.description ?? null,
      );
      if (!normalized || !rule.match_value) return false;
      switch (rule.match_operator ?? "starts_with") {
        case "is_exactly":
          return normalized === rule.match_value;
        case "contains":
          return normalized.includes(rule.match_value);
        case "starts_with":
        default:
          return (
            normalized === rule.match_value ||
            normalized.startsWith(rule.match_value + " ")
          );
      }
    }
    default:
      return false;
  }
}

/**
 * The rule that governs this transaction, or null.
 *
 * Precedence: merchant_entity, then mcc, then name_pattern; within
 * name_pattern the longest match_value wins so a specific rule beats a
 * generic one. When two name_pattern rules tie on value length too — a real
 * case now that a value can carry three different operators — the more
 * specific operator wins (is_exactly, then starts_with, then contains): the
 * rule that could only ever have meant this one merchant governs over the
 * one that happens to also reach it.
 *
 * Mirrors findGoverningRule in the Deno copy — the two must agree, or a
 * transaction gets one answer at ingest and a different one on screen.
 */
export function findGoverningRule<T extends MatchableRule>(
  rules: readonly T[],
  input: RuleMatchInput,
): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue;
    if (!best) {
      best = rule;
      continue;
    }
    const rank = MATCH_TYPE_PRECEDENCE[rule.match_type];
    const bestRank = MATCH_TYPE_PRECEDENCE[best.match_type];
    if (rank < bestRank) {
      best = rule;
      continue;
    }
    if (rank !== bestRank) continue;

    if (rule.match_value.length !== best.match_value.length) {
      if (rule.match_value.length > best.match_value.length) best = rule;
      continue;
    }

    const opRank =
      MATCH_OPERATOR_SPECIFICITY[rule.match_operator ?? "starts_with"];
    const bestOpRank =
      MATCH_OPERATOR_SPECIFICITY[best.match_operator ?? "starts_with"];
    if (opRank < bestOpRank) best = rule;
  }
  return best;
}

/**
 * Pick the most durable rule key available for a transaction.
 *
 * Prefers Plaid's stable merchant id, then the normalized name, and only then
 * MCC. Note this is NOT the evaluation precedence (where MCC outranks name) —
 * it is what to *suggest* when the user rules on one merchant. An MCC rule
 * covers an entire category, so offering it for "mark CVS as medical" would
 * silently sweep in every other pharmacy; a name rule matches what the user
 * actually pointed at. MCC is offered only when there is no usable name.
 *
 * The 2026-08-14 sandbox probe measured merchant_entity_id on only ~44% of
 * transactions, so the name path is not a rare edge case — it is the common
 * one, and has to be good.
 */
export function suggestRuleKey(txn: {
  merchant_entity_id?: string | null;
  merchant_category_code?: string | null;
  vendor?: string | null;
  description?: string | null;
}): { matchType: RuleMatchType; matchValue: string } | null {
  if (txn.merchant_entity_id) {
    return {
      matchType: "merchant_entity",
      matchValue: txn.merchant_entity_id,
    };
  }
  const normalized = normalizeMerchantName(
    txn.vendor ?? txn.description ?? null,
  );
  if (normalized) {
    return { matchType: "name_pattern", matchValue: normalized };
  }
  if (txn.merchant_category_code) {
    return { matchType: "mcc", matchValue: txn.merchant_category_code };
  }
  return null;
}
