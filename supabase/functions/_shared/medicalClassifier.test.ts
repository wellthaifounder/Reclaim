// Tests for the medical-transaction classifier.
//
// Run:  cd supabase/functions && deno test _shared/medicalClassifier.test.ts
//
// Uses Deno's built-in test runner — the repo has no JS test framework and this
// module is Deno code, so no dependency is added.
//
// The false-positive cases are the point. Before the 2026-08-14 rewrite the
// keyword list matched unanchored substrings including "lab", "rx", "health",
// "sharp" and "dr ", so Dr Pepper and Sharp Electronics went into the review
// queue. Each of those merchants is pinned below.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  _resetMccCacheForTests,
  classifyTransaction,
  type PlaidTxnLike,
} from "./medicalClassifier.ts";
import type { CategorizationRule } from "./categorizationRules.ts";

// ── Minimal Supabase stub ─────────────────────────────────────────────────
// Only mcc_codes is ever read, and only these three columns.
function stubSupabase(
  rows: Array<{
    code: string;
    irs_category: string | null;
    default_pub_502_rule_id: string | null;
  }> = [],
) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const MCC_ROWS = [
  {
    code: "8011",
    irs_category: "Doctors",
    default_pub_502_rule_id: "doctor-visits",
  },
  {
    code: "5912",
    irs_category: "Pharmacy",
    default_pub_502_rule_id: "prescription-drugs",
  },
];

function txn(partial: Partial<PlaidTxnLike> & { name: string }): PlaidTxnLike {
  return { merchant_name: null, category: null, mcc: null, ...partial };
}

/** Build a categorization rule. match_value is stored already-normalized. */
function rule(
  match_type: CategorizationRule["match_type"],
  match_value: string,
  is_medical: boolean,
): CategorizationRule {
  return {
    id: crypto.randomUUID(),
    match_type,
    match_value,
    is_medical,
    display_label: match_value,
  };
}

async function classify(
  t: PlaidTxnLike,
  rules: CategorizationRule[] = [],
  rows = MCC_ROWS,
) {
  _resetMccCacheForTests();
  return await classifyTransaction(stubSupabase(rows), t, rules);
}

// ── False positives: the whole reason for the rewrite ─────────────────────

Deno.test(
  "does not flag merchants that merely contain medical substrings",
  async () => {
    const traps: Array<[string, string]> = [
      ["DR PEPPER SNAPPLE", "contains 'dr '"],
      ["Sharp Electronics", "contains 'sharp'"],
      ["Univision Communications", "contains 'vision'"],
      ["The Lab Kitchen & Bar", "contains 'lab'"],
      ["COLLAB WORKSPACE", "contains 'lab'"],
      ["Whole Foods Market", "grocery"],
      ["TRXADE GROUP", "contains 'rx'"],
      ["Healthy Bowl Cafe", "contains 'health' as a prefix only"],
    ];
    for (const [name, why] of traps) {
      const r = await classify(txn({ name }));
      assertEquals(
        r.isMedical,
        false,
        `"${name}" should not be medical (${why})`,
      );
    }
  },
);

Deno.test(
  "a credit-card payment is never medical, whatever the name says",
  async () => {
    const r = await classify(
      txn({
        name: "CVS PHARMACY CARD PAYMENT",
        personal_finance_category: {
          primary: "LOAN_PAYMENTS",
          detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          confidence_level: "VERY_HIGH",
        },
      }),
    );
    assertEquals(r.isMedical, false);
    assertEquals(r.reason, "excluded");
  },
);

Deno.test("transfers into an HSA are not medical expenses", async () => {
  const r = await classify(
    txn({
      name: "HSA CONTRIBUTION",
      personal_finance_category: {
        primary: "TRANSFER_OUT",
        detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        confidence_level: "HIGH",
      },
    }),
  );
  assertEquals(r.isMedical, false);
  assertEquals(r.reason, "excluded");
});

Deno.test(
  "veterinary care is excluded despite Plaid's MEDICAL primary",
  async () => {
    const r = await classify(
      txn({
        name: "VCA ANIMAL HOSPITAL",
        personal_finance_category: {
          primary: "MEDICAL",
          detailed: "MEDICAL_VETERINARY_SERVICES",
          confidence_level: "VERY_HIGH",
        },
      }),
    );
    assertEquals(r.isMedical, false);
    assertEquals(r.reason, "excluded");
  },
);

// ── True positives ────────────────────────────────────────────────────────

Deno.test("MCC tier fires and carries the Pub 502 rule", async () => {
  const r = await classify(txn({ name: "SOME CLINIC LLC", mcc: "8011" }));
  assertEquals(r.isMedical, true);
  assertEquals(r.needsReview, true);
  assertEquals(r.reason, "mcc");
  assertEquals(r.pub502RuleId, "doctor-visits");
  assertEquals(r.irsCategory, "Doctors");
});

Deno.test(
  "even a very-high-confidence Plaid category still waits for the user",
  async () => {
    const r = await classify(
      txn({
        name: "MERCY PRIMARY CARE",
        personal_finance_category: {
          primary: "MEDICAL",
          detailed: "MEDICAL_PRIMARY_CARE",
          confidence_level: "VERY_HIGH",
        },
      }),
    );
    assertEquals(r.isMedical, true);
    assertEquals(r.needsReview, true);
    assertEquals(r.reason, "personal_finance_category");
  },
);

Deno.test(
  "low-confidence Plaid category is medical but routed to review",
  async () => {
    const r = await classify(
      txn({
        name: "SOMETHING AMBIGUOUS",
        personal_finance_category: {
          primary: "MEDICAL",
          detailed: "MEDICAL_OTHER_MEDICAL",
          confidence_level: "LOW",
        },
      }),
    );
    assertEquals(r.isMedical, true);
    assertEquals(r.needsReview, true);
  },
);

Deno.test("both known brands and generic terms go to review", async () => {
  const brand = await classify(
    txn({ name: "WALGREENS #4521", merchant_name: "Walgreens" }),
  );
  assertEquals(brand.isMedical, true);
  assertEquals(brand.needsReview, true);

  const generic = await classify(txn({ name: "RIVERSIDE DENTAL GROUP" }));
  assertEquals(generic.isMedical, true);
  assertEquals(generic.needsReview, true);
});

// The one thing that still decides without asking, and why: a rule IS the
// user's decision, recorded once and applied standing. Take this away and the
// rules screen does nothing.
Deno.test("a user's own rule still decides without review", async () => {
  const r = await classify(txn({ name: "NW HEALTH BENTONVILLE" }), [
    rule("name_pattern", "nw health", true),
  ]);
  assertEquals(r.isMedical, true);
  assertEquals(r.needsReview, false);
  assertEquals(r.reason, "rule");
});

// The classifier must never confirm anything on its own. This is the guard on
// the whole model: a confirmed transaction becomes an expense, and an expense
// is a claim against an HSA.
Deno.test("no signal tier ever confirms medical without the user", async () => {
  const signals = [
    txn({ name: "SOME CLINIC LLC", mcc: "8011" }),
    txn({ name: "WALGREENS #4521", merchant_name: "Walgreens" }),
    txn({
      name: "MERCY PRIMARY CARE",
      personal_finance_category: {
        primary: "MEDICAL",
        detailed: "MEDICAL_PRIMARY_CARE",
        confidence_level: "VERY_HIGH",
      },
    }),
  ];
  for (const t of signals) {
    const r = await classify(t);
    assertEquals(r.isMedical, true);
    assertEquals(
      r.needsReview,
      true,
      `${t.name} was confirmed medical without the user`,
    );
  }
});

// ── User preference ───────────────────────────────────────────────────────

Deno.test(
  "a user rule overrides everything, including the hard exclusions",
  async () => {
    const r = await classify(
      txn({
        name: "VCA ANIMAL HOSPITAL",
        personal_finance_category: {
          primary: "MEDICAL",
          detailed: "MEDICAL_VETERINARY_SERVICES",
          confidence_level: "VERY_HIGH",
        },
      }),
      // Service-animal care is a qualified expense, so a user rule must be able
      // to override the veterinary exclusion.
      [rule("name_pattern", "vca", true)],
    );
    assertEquals(r.isMedical, true);
    assertEquals(r.reason, "rule");
  },
);

Deno.test("the most specific name-pattern rule wins", async () => {
  const r = await classify(txn({ name: "TARGET PHARMACY #22" }), [
    rule("name_pattern", "target", false),
    rule("name_pattern", "target pharmacy", true),
  ]);
  assertEquals(r.isMedical, true);
});

Deno.test(
  "a name-pattern rule does not match a longer word with the same prefix",
  async () => {
    // "cvs" must not match "MYCVSHEALTHYSNACKS" — and after normalization the
    // descriptor is one token, so a prefix match is the only risk.
    const r = await classify(txn({ name: "CVSHEALTHYSNACKS LLC" }), [
      rule("name_pattern", "cvs", true),
    ]);
    assertEquals(r.reason !== "rule", true);
  },
);

Deno.test("an entity rule outranks the MCC tier", async () => {
  // MCC 8011 alone would classify this as medical; the user's rule says no.
  const r = await classify(
    txn({ name: "DR SMITH", mcc: "8011", merchant_entity_id: "ent_abc" }),
    [rule("merchant_entity", "ent_abc", false)],
  );
  assertEquals(r.isMedical, false);
  assertEquals(r.reason, "rule");
});

Deno.test("a rule result carries its rule id for provenance", async () => {
  const r0 = rule("name_pattern", "walgreens", true);
  const r = await classify(txn({ name: "WALGREENS #4821" }), [r0]);
  assertEquals(r.ruleId, r0.id);
});

// ── Possible-OTC lane ─────────────────────────────────────────────────────
// Widening the net (Phase 4): grocery/general-merchandise/warehouse-club
// merchants stay NOT medical — no phantom expense, no total moved — but now
// get queued for review, since a basket there can still contain an
// IRS-qualifying item. "Whole Foods Market" was previously pinned in the
// false-positives test above purely as isMedical === false; it still belongs
// there, but now also has a stronger claim to pin: it should land specifically
// in the OTC lane rather than being silently discarded as "none".

Deno.test(
  "a grocery merchant is queued for review without becoming medical",
  async () => {
    const r = await classify(txn({ name: "Whole Foods Market" }));
    assertEquals(r.isMedical, false);
    assertEquals(r.needsReview, true);
    assertEquals(r.reason, "possible_otc");
  },
);

Deno.test(
  "Plaid's grocery/general-merchandise categories route to the OTC lane, not medical",
  async () => {
    const r = await classify(
      txn({
        name: "TARGET T-1234",
        personal_finance_category: {
          primary: "GENERAL_MERCHANDISE",
          detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
          confidence_level: "VERY_HIGH",
        },
      }),
    );
    assertEquals(r.isMedical, false);
    assertEquals(r.needsReview, true);
    assertEquals(r.reason, "possible_otc");
  },
);

Deno.test(
  "a warehouse-club brand name alone is enough to queue for review",
  async () => {
    const r = await classify(txn({ name: "COSTCO WHSE #0442" }));
    assertEquals(r.isMedical, false);
    assertEquals(r.needsReview, true);
    assertEquals(r.reason, "possible_otc");
  },
);

Deno.test(
  "a user rule still overrides the OTC lane, same as every other tier",
  async () => {
    const r = await classify(txn({ name: "Whole Foods Market" }), [
      rule("name_pattern", "whole foods market", true),
    ]);
    assertEquals(r.isMedical, true);
    assertEquals(r.reason, "rule");
  },
);

Deno.test(
  "a plain grocery run with no OTC signal at all stays fully silent",
  async () => {
    // Confirms the OTC lane didn't accidentally widen to catch everything —
    // a merchant with no grocery/general-merchandise/warehouse-club signal at
    // all (medical or otherwise) is still "none", not "possible_otc".
    const r = await classify(txn({ name: "STARBUCKS" }));
    assertEquals(r.isMedical, false);
    assertEquals(r.needsReview, false);
    assertEquals(r.reason, "none");
  },
);

// ── Explanation ───────────────────────────────────────────────────────────

Deno.test(
  "every result carries a non-empty explanation for the why chip",
  async () => {
    const cases: PlaidTxnLike[] = [
      txn({ name: "WALGREENS" }),
      txn({ name: "STARBUCKS" }),
      txn({ name: "CLINIC", mcc: "8011" }),
      txn({
        name: "X",
        personal_finance_category: {
          primary: "LOAN_PAYMENTS",
          detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          confidence_level: "HIGH",
        },
      }),
    ];
    for (const c of cases) {
      const r = await classify(c);
      assertEquals(
        r.explanation.length > 0,
        true,
        `missing explanation for ${c.name}`,
      );
    }
  },
);
