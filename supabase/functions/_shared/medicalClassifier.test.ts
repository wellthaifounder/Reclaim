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

async function classify(t: PlaidTxnLike, prefs = [], rows = MCC_ROWS) {
  _resetMccCacheForTests();
  return await classifyTransaction(stubSupabase(rows), t, prefs);
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
  assertEquals(r.needsReview, false);
  assertEquals(r.reason, "mcc");
  assertEquals(r.pub502RuleId, "doctor-visits");
  assertEquals(r.irsCategory, "Doctors");
});

Deno.test(
  "high-confidence Plaid category is accepted without review",
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
    assertEquals(r.needsReview, false);
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

Deno.test("known brands are accepted; generic terms go to review", async () => {
  const brand = await classify(
    txn({ name: "WALGREENS #4521", merchant_name: "Walgreens" }),
  );
  assertEquals(brand.isMedical, true);
  assertEquals(brand.needsReview, false);

  const generic = await classify(txn({ name: "RIVERSIDE DENTAL GROUP" }));
  assertEquals(generic.isMedical, true);
  assertEquals(generic.needsReview, true);
});

// ── User preference ───────────────────────────────────────────────────────

Deno.test(
  "user preference overrides everything, including exclusions",
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
      // Service-animal care is a qualified expense, so the user must be able to
      // override the veterinary exclusion.
      [{ vendor_pattern: "VCA", is_medical: true }] as never,
    );
    assertEquals(r.isMedical, true);
    assertEquals(r.reason, "user_preference");
  },
);

Deno.test("the most specific user preference wins", async () => {
  const r = await classify(txn({ name: "TARGET PHARMACY #22" }), [
    { vendor_pattern: "Target", is_medical: false },
    { vendor_pattern: "Target Pharmacy", is_medical: true },
  ] as never);
  assertEquals(r.isMedical, true);
});

Deno.test(
  "user preference matches on a word boundary, not a bare substring",
  async () => {
    // "CVS" must not match "CVSHEALTHYSNACKS" mid-word.
    const r = await classify(txn({ name: "MYCVSHEALTHYSNACKS LLC" }), [
      { vendor_pattern: "CVS", is_medical: true },
    ] as never);
    assertEquals(r.reason !== "user_preference", true);
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
