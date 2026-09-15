// Reclaim — categorization rules: normalization, precedence, matching.
//
// Workstream C3. Replaces `user_vendor_preferences`, which keyed on a lowercase
// substring of the vendor name, was written silently from three call sites, and
// had no UI to list, edit or undo — a mislabelled vendor was permanent.
//
// This module is the single definition of how a rule matches. It is mirrored in
// two other places that MUST agree with it:
//
//   - SQL: public.normalize_merchant_name / public.transaction_matches_rule
//     (20260815120000_categorization_rules.sql, operators added in
//     20260915210000_rule_name_match_operators.sql). The database does
//     retroactive apply; this module does apply-at-ingest. If they diverge,
//     the count shown in "apply to 47 past transactions" stops matching what
//     actually changes.
//   - Browser: src/lib/merchantNormalize.ts, which re-exports normalization so
//     a rule created in the UI is stored in the same shape.
//
// The normalization regexes are duplicated across the three rather than shared,
// because Deno, Postgres and the browser bundle cannot import from one another.
// The test suite pins the shapes that matter; change all three together.

/** Precedence order. Lower number wins. */
export const MATCH_TYPE_PRECEDENCE = {
  merchant_entity: 1,
  mcc: 2,
  name_pattern: 3,
} as const;

export type RuleMatchType = keyof typeof MATCH_TYPE_PRECEDENCE;

// docs/TRANSACTION_REVIEW_SPEC.md D22. Only name_pattern rules read this —
// entity and mcc rules always match on exact equality of that one signal, so
// there is nothing for an operator to choose between. Specificity order
// (lower wins a tie) mirrors how obviously "on purpose" a rule reads: an
// exact match can only ever have been meant for the one merchant it names;
// "contains" is the one capable of catching things nobody meant (D23).
export const MATCH_OPERATOR_SPECIFICITY = {
  is_exactly: 1,
  starts_with: 2,
  contains: 3,
} as const;

export type RuleMatchOperator = keyof typeof MATCH_OPERATOR_SPECIFICITY;

export interface CategorizationRule {
  id: string;
  match_type: RuleMatchType;
  match_value: string;
  is_medical: boolean;
  display_label?: string | null;
  /** Only consulted for match_type 'name_pattern'. Defaults to 'starts_with'
   *  — today's only behaviour — for callers (older data, tests) that predate
   *  this field. */
  match_operator?: RuleMatchOperator;
}

/** The transaction-side signals a rule can key on. */
export interface RuleMatchInput {
  merchantEntityId?: string | null;
  merchantCategoryCode?: string | null;
  /** Raw merchant name; normalized internally. */
  merchantName?: string | null;
}

/**
 * Normalize a merchant descriptor to a stable comparison key.
 *
 * Must produce byte-identical output to public.normalize_merchant_name.
 * Order matters: processor prefix, then trailing store number, then collapse.
 */
export function normalizeMerchantName(name: string | null): string | null {
  const normalized = (name ?? "")
    .toLowerCase()
    // Payment-processor prefixes: "SQ *", "TST* ", "PAYPAL *".
    .replace(/^(sq|tst|sp|pp|paypal|pos|ach|dd|ext|py|chk)\s*\*+\s*/, "")
    // Trailing store/reference numbers: "walgreens #4821".
    .replace(/\s*[#*]?\s*\d{3,}\s*$/, "")
    // Everything else that is not alphanumeric becomes a single space.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized === "" ? null : normalized;
}

/**
 * Does this rule match this transaction?
 *
 * D22's three operators, for a name_pattern rule:
 *   - is_exactly:   the normalized names are equal, full stop.
 *   - starts_with:  a word-boundary prefix match — "walgreens" catches
 *                   "walgreens store" but not "walgreensxyz cafe". This is
 *                   the original, and still default, behaviour; it's the
 *                   whole reason the old bare-substring matcher flagged Dr
 *                   Pepper as a Pepcid rule.
 *   - contains:     a raw substring match, no boundary at all. The one
 *                   operator that can reach a healthcare billing middleman
 *                   like `ATHENAHEALTH*SMITH FAMILY MED` — and the one that
 *                   can also catch Mediterranean Grill on a rule meant for
 *                   "med" (D23's own example). Deliberately not smartened up
 *                   to avoid that; see preview_categorization_rule_names in
 *                   the migration for how the UI is meant to warn about it
 *                   instead.
 */
export function ruleMatches(
  rule: CategorizationRule,
  input: RuleMatchInput,
): boolean {
  switch (rule.match_type) {
    case "merchant_entity":
      return (
        !!input.merchantEntityId && input.merchantEntityId === rule.match_value
      );
    case "mcc":
      return (
        !!input.merchantCategoryCode &&
        input.merchantCategoryCode === rule.match_value
      );
    case "name_pattern": {
      const normalized = normalizeMerchantName(input.merchantName ?? null);
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
 * Precedence chain: merchant_entity, then mcc, then name_pattern. Within
 * name_pattern the longest match_value wins, so a specific rule ("cvs
 * pharmacy") beats a generic one ("cvs") rather than whichever was created
 * first. When two name_pattern rules tie on value length too — a real case
 * now that a value can carry three different operators, e.g. an is_exactly
 * "medina bakery" rule alongside an unrelated contains "medina bakery" rule
 * — the more specific operator wins, same rationale as the length check:
 * the rule that could only ever have meant this one merchant governs over
 * the one that happens to also reach it.
 *
 * Revised from the original plan after the 2026-08-14 sandbox probe measured
 * merchant_entity_id on only ~44% of transactions — precise when present, but
 * absent too often to be the sole key.
 */
export function findGoverningRule(
  rules: readonly CategorizationRule[],
  input: RuleMatchInput,
): CategorizationRule | null {
  let best: CategorizationRule | null = null;

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

/** Human-readable justification for the "why" chip. */
export function explainRule(rule: CategorizationRule): string {
  const label = rule.display_label || rule.match_value;
  const verdict = rule.is_medical ? "medical" : "not medical";
  switch (rule.match_type) {
    case "merchant_entity":
      return `Rule: ${label} is ${verdict}.`;
    case "mcc":
      return `Rule: merchant category ${rule.match_value} is ${verdict}.`;
    case "name_pattern":
      return `Rule: ${label} is ${verdict}.`;
  }
}
