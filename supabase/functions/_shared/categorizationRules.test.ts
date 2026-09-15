// Tests for the categorization rules matcher.
//
// Run: deno test supabase/functions/_shared/categorizationRules.test.ts
//
// The normalization cases here are the same strings verified against
// public.normalize_merchant_name in Postgres. If you change one, change both —
// retroactive apply runs in SQL and apply-at-ingest runs here, and a divergence
// means the "apply to N past transactions" count lies.

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CategorizationRule,
  findGoverningRule,
  normalizeMerchantName,
  ruleMatches,
} from "./categorizationRules.ts";

const rule = (
  o: Partial<CategorizationRule> &
    Pick<CategorizationRule, "match_type" | "match_value">,
): CategorizationRule => ({
  id: crypto.randomUUID(),
  is_medical: true,
  display_label: null,
  ...o,
});

// ── Normalization ─────────────────────────────────────────────────────────

Deno.test("normalize strips payment-processor prefixes", () => {
  assertEquals(normalizeMerchantName("SQ *DR SMITH"), "dr smith");
  assertEquals(
    normalizeMerchantName("TST* The Lab Kitchen"),
    "the lab kitchen",
  );
  assertEquals(normalizeMerchantName("PAYPAL *TELADOC"), "teladoc");
});

Deno.test("normalize strips trailing store numbers", () => {
  assertEquals(normalizeMerchantName("WALGREENS #4821"), "walgreens");
  assertEquals(normalizeMerchantName("CVS/PHARMACY 03412"), "cvs pharmacy");
});

Deno.test("normalize collapses punctuation and whitespace", () => {
  assertEquals(normalizeMerchantName("  Walgreens  "), "walgreens");
  assertEquals(normalizeMerchantName("CVS/PHARMACY"), "cvs pharmacy");
});

Deno.test("normalize returns null for content-free descriptors", () => {
  assertEquals(normalizeMerchantName("###"), null);
  assertEquals(normalizeMerchantName(""), null);
  assertEquals(normalizeMerchantName(null), null);
});

Deno.test(
  "normalize keeps a short numeric suffix that is part of the name",
  () => {
    // Only runs of 3+ digits are treated as a store number, so "7 Eleven" and
    // "1-800 CONTACTS" survive.
    assertEquals(normalizeMerchantName("1-800 CONTACTS"), "1 800 contacts");
  },
);

// ── Name-pattern matching ─────────────────────────────────────────────────

Deno.test(
  "name pattern matches the same merchant across descriptor variants",
  () => {
    const r = rule({ match_type: "name_pattern", match_value: "walgreens" });
    for (const name of ["WALGREENS #4821", "Walgreens", "SQ *WALGREENS 991"]) {
      assertEquals(ruleMatches(r, { merchantName: name }), true, name);
    }
  },
);

Deno.test(
  "name pattern does not match a longer word with the same prefix",
  () => {
    // This is the defect class the old substring matcher had: "lab" matching
    // "The Lab Kitchen", "vision" matching "Univision".
    const r = rule({ match_type: "name_pattern", match_value: "walgreens" });
    assertEquals(ruleMatches(r, { merchantName: "WALGREENSXYZ CAFE" }), false);

    const lab = rule({ match_type: "name_pattern", match_value: "lab" });
    assertEquals(ruleMatches(lab, { merchantName: "The Lab Kitchen" }), false);
    assertEquals(
      ruleMatches(lab, { merchantName: "LAB CORP OF AMERICA" }),
      true,
    );
  },
);

Deno.test(
  "name pattern ignores a transaction with no usable merchant name",
  () => {
    const r = rule({ match_type: "name_pattern", match_value: "walgreens" });
    assertEquals(ruleMatches(r, { merchantName: "###" }), false);
    assertEquals(ruleMatches(r, { merchantName: null }), false);
  },
);

Deno.test(
  "name pattern defaults to starts_with when the field is absent",
  () => {
    // A rule row from before this field existed, or a caller that never set
    // it — ruleMatches must still behave exactly as it always did, since
    // plaid-webhook and plaid-sync-transactions both select this column
    // explicitly and a missed one there would silently downgrade every rule
    // to starts_with with no error anywhere.
    const r: CategorizationRule = {
      id: crypto.randomUUID(),
      match_type: "name_pattern",
      match_value: "walgreens",
      is_medical: true,
    };
    assertEquals(ruleMatches(r, { merchantName: "Walgreens Store" }), true);
    assertEquals(ruleMatches(r, { merchantName: "Walgreensxyz Cafe" }), false);
  },
);

// ── D22: the three operators ──────────────────────────────────────────────

Deno.test("is_exactly matches only the normalized name itself", () => {
  const r = rule({
    match_type: "name_pattern",
    match_value: "walgreens",
    match_operator: "is_exactly",
  });
  assertEquals(ruleMatches(r, { merchantName: "Walgreens" }), true);
  assertEquals(ruleMatches(r, { merchantName: "Walgreens Store" }), false);
});

Deno.test("starts_with is unchanged from the original behaviour", () => {
  const r = rule({
    match_type: "name_pattern",
    match_value: "walgreens",
    match_operator: "starts_with",
  });
  assertEquals(ruleMatches(r, { merchantName: "Walgreens Store" }), true);
  assertEquals(ruleMatches(r, { merchantName: "Walgreensxyz Cafe" }), false);
});

Deno.test(
  "contains reaches a healthcare billing middleman that starts_with cannot (spec D22)",
  () => {
    const value = "smith family med";
    const middleman = "ATHENAHEALTH*SMITH FAMILY MED";
    const startsWith = rule({
      match_type: "name_pattern",
      match_value: value,
      match_operator: "starts_with",
    });
    const contains = rule({
      match_type: "name_pattern",
      match_value: value,
      match_operator: "contains",
    });
    assertEquals(ruleMatches(startsWith, { merchantName: middleman }), false);
    assertEquals(ruleMatches(contains, { merchantName: middleman }), true);
  },
);

Deno.test(
  "contains also catches what it isn't meant to (spec D23's own warning example)",
  () => {
    const r = rule({
      match_type: "name_pattern",
      match_value: "med",
      match_operator: "contains",
    });
    assertEquals(ruleMatches(r, { merchantName: "Mediterranean Grill" }), true);
    assertEquals(ruleMatches(r, { merchantName: "Medina Bakery" }), true);
  },
);

Deno.test("an unrecognised operator value falls back to starts_with", () => {
  // Defensive: an enum widened in the database ahead of this module (or a
  // stale deploy reading a newer row) should degrade to the safest, original
  // behaviour rather than throw or silently match everything.
  const r = rule({
    match_type: "name_pattern",
    match_value: "walgreens",
    // deno-lint-ignore no-explicit-any
    match_operator: "some_future_operator" as any,
  });
  assertEquals(ruleMatches(r, { merchantName: "Walgreens Store" }), true);
  assertEquals(ruleMatches(r, { merchantName: "Walgreensxyz Cafe" }), false);
});

// ── Entity and MCC matching ───────────────────────────────────────────────

Deno.test("entity and mcc rules require the signal to be present", () => {
  const ent = rule({ match_type: "merchant_entity", match_value: "ent_abc" });
  assertEquals(ruleMatches(ent, { merchantEntityId: "ent_abc" }), true);
  assertEquals(ruleMatches(ent, { merchantEntityId: null }), false);

  const mcc = rule({ match_type: "mcc", match_value: "8011" });
  assertEquals(ruleMatches(mcc, { merchantCategoryCode: "8011" }), true);
  assertEquals(ruleMatches(mcc, { merchantCategoryCode: null }), false);
});

// ── Precedence ────────────────────────────────────────────────────────────

Deno.test("entity beats mcc beats name pattern", () => {
  const byName = rule({
    match_type: "name_pattern",
    match_value: "dr smith",
    is_medical: true,
  });
  const byMcc = rule({
    match_type: "mcc",
    match_value: "8011",
    is_medical: true,
  });
  const byEntity = rule({
    match_type: "merchant_entity",
    match_value: "ent_abc",
    is_medical: false,
  });

  const input = {
    merchantName: "DR SMITH",
    merchantCategoryCode: "8011",
    merchantEntityId: "ent_abc",
  };

  assertEquals(
    findGoverningRule([byName, byMcc, byEntity], input)?.id,
    byEntity.id,
  );
  assertEquals(findGoverningRule([byName, byMcc], input)?.id, byMcc.id);
  assertEquals(findGoverningRule([byName], input)?.id, byName.id);
});

Deno.test("precedence is independent of rule ordering", () => {
  const byName = rule({ match_type: "name_pattern", match_value: "cvs" });
  const byEntity = rule({ match_type: "merchant_entity", match_value: "e1" });
  const input = { merchantName: "CVS", merchantEntityId: "e1" };

  assertEquals(
    findGoverningRule([byName, byEntity], input)?.id,
    findGoverningRule([byEntity, byName], input)?.id,
  );
});

Deno.test("the more specific name pattern wins over the generic one", () => {
  const generic = rule({ match_type: "name_pattern", match_value: "cvs" });
  const specific = rule({
    match_type: "name_pattern",
    match_value: "cvs pharmacy",
    is_medical: false,
  });
  const found = findGoverningRule([generic, specific], {
    merchantName: "CVS/PHARMACY 03412",
  });
  assertEquals(found?.id, specific.id);
  assertNotEquals(found?.id, generic.id);
});

Deno.test("no matching rule yields null rather than a default", () => {
  const r = rule({ match_type: "name_pattern", match_value: "walgreens" });
  assertEquals(findGoverningRule([r], { merchantName: "NETFLIX" }), null);
  assertEquals(findGoverningRule([], { merchantName: "WALGREENS" }), null);
});

Deno.test(
  "when two name patterns tie on value length, the more specific operator wins (spec D22)",
  () => {
    // Same match_value, different operators — a real case now that a value
    // alone no longer determines how surgical a rule is. An is_exactly rule
    // for "medina bakery" can only ever have meant that one merchant; a
    // contains rule for the same string is the one that also reaches, say,
    // "Medina Bakery & Cafe". The narrower one should govern.
    const exact = rule({
      match_type: "name_pattern",
      match_value: "medina bakery",
      match_operator: "is_exactly",
      is_medical: false,
    });
    const contains = rule({
      match_type: "name_pattern",
      match_value: "medina bakery",
      match_operator: "contains",
      is_medical: true,
    });
    const found = findGoverningRule([contains, exact], {
      merchantName: "Medina Bakery",
    });
    assertEquals(found?.id, exact.id);

    // Order-independent, same as the match_type precedence check above.
    const foundReversed = findGoverningRule([exact, contains], {
      merchantName: "Medina Bakery",
    });
    assertEquals(foundReversed?.id, exact.id);
  },
);
