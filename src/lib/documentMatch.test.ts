// Run with `npm test` (node --test). SUBSTANTIATE_SPEC S3, S4, S6.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentsToCatchUp,
  likelyMatches,
  matchReason,
  providerKey,
  rankForPicker,
  sameProvider,
  type Backing,
  type Charge,
  type MatchableDocument,
} from "./documentMatch.ts";

const charge: Charge = {
  invoiceId: "this",
  paidDate: "2026-09-15",
  amounts: [85],
  providerNames: ["SQ *SMILE DENTAL 8842"],
};

function doc(
  id: string,
  scan: Partial<NonNullable<MatchableDocument["scan"]>> | null,
  extra: Partial<MatchableDocument> = {},
): MatchableDocument {
  return {
    id,
    uploaded_at: "2026-09-01T00:00:00Z",
    backs: [],
    scan:
      scan === null
        ? null
        : {
            scan_status: "read",
            extracted_amount: null,
            extracted_vendor: null,
            extracted_date: null,
            extracted_bill_date: null,
            extracted_service_date: null,
            extracted_service_date_end: null,
            ...scan,
          },
    ...extra,
  };
}

const backing = (
  invoiceId: string,
  amount: number,
  vendor = "MERCY HOSP PMT 0815",
): Backing => ({ invoiceId, amount, vendor, vendorOriginal: vendor });

// ── A. Same amount ─────────────────────────────────────────────────────────

test("same amount, same day is a match", () => {
  const d = doc("a", { extracted_amount: 85, extracted_date: "2026-09-15" });
  assert.deepEqual(matchReason(d, charge), { kind: "amount", distance: 0 });
});

test("amount is compared to the cent, and numeric strings count", () => {
  const exact = doc("a", {
    extracted_amount: "85.00",
    extracted_date: "2026-09-14",
  });
  const off = doc("b", {
    extracted_amount: 85.01,
    extracted_date: "2026-09-14",
  });
  assert.deepEqual(matchReason(exact, charge), {
    kind: "amount",
    distance: 1,
  });
  assert.equal(matchReason(off, charge), null);
});

test("window: up to a year before the payment, up to a week after", () => {
  const at = (date: string) =>
    matchReason(
      doc("a", { extracted_amount: 85, extracted_date: date }),
      charge,
    );
  assert.deepEqual(at("2025-09-16"), { kind: "amount", distance: 364 });
  assert.equal(at("2025-09-01"), null);
  assert.deepEqual(at("2026-09-22"), { kind: "amount", distance: 7 });
  assert.equal(at("2026-09-23"), null);
});

test("the nearest of the document's dates is used", () => {
  const d = doc("a", {
    extracted_amount: 85,
    extracted_service_date: "2026-08-01",
    extracted_date: "2026-09-13",
  });
  assert.deepEqual(matchReason(d, charge), { kind: "amount", distance: 2 });
});

test("unread, unreadable, dateless or different-amount documents don't match", () => {
  assert.equal(matchReason(doc("a", null), charge), null);
  assert.equal(
    matchReason(
      doc("b", {
        scan_status: "unreadable",
        extracted_amount: 85,
        extracted_date: "2026-09-15",
      }),
      charge,
    ),
    null,
  );
  assert.equal(matchReason(doc("c", { extracted_amount: 85 }), charge), null);
  assert.equal(
    matchReason(
      doc("d", { extracted_amount: 850, extracted_date: "2026-09-15" }),
      charge,
    ),
    null,
  );
});

test("a document on another expense can still match by amount", () => {
  const d = doc(
    "a",
    { extracted_amount: 85, extracted_date: "2026-09-15" },
    { backs: [backing("other", 85, "SOMEWHERE ELSE")] },
  );
  assert.deepEqual(matchReason(d, charge), { kind: "amount", distance: 0 });
});

test("a document already on this expense never matches", () => {
  const d = doc(
    "a",
    { extracted_amount: 85, extracted_date: "2026-09-15" },
    { backs: [backing("this", 85)] },
  );
  assert.equal(matchReason(d, charge), null);
});

test("a split share matches a receipt for the full bank charge", () => {
  const split: Charge = { ...charge, amounts: [12.5, 12.5, 45.2] };
  const receipt = doc("a", {
    extracted_amount: 45.2,
    extracted_date: "2026-09-15",
  });
  assert.deepEqual(matchReason(receipt, split), {
    kind: "amount",
    distance: 0,
  });
});

// ── B. Payment plans ───────────────────────────────────────────────────────

const instalment: Charge = {
  invoiceId: "this",
  paidDate: "2027-03-15",
  amounts: [250],
  providerNames: ["MERCY HOSP PMT 0315"],
};
const statement = (backs: Backing[]) =>
  doc(
    "stmt",
    {
      extracted_amount: 3000,
      extracted_vendor: "Mercy Hospital",
      extracted_bill_date: "2026-08-01",
    },
    { backs },
  );

test("a statement on an earlier instalment is offered on the next, any date", () => {
  assert.deepEqual(
    matchReason(
      statement([backing("i1", 250), backing("i2", 250)]),
      instalment,
    ),
    { kind: "plan" },
  );
});

test("a paid-off statement is no longer offered", () => {
  const paid = Array.from({ length: 12 }, (_, i) => backing(`i${i}`, 250));
  assert.equal(matchReason(statement(paid), instalment), null);
});

test("a statement from a different provider is not offered", () => {
  const other: Charge = { ...instalment, providerNames: ["CITY CLINIC"] };
  assert.equal(matchReason(statement([backing("i1", 250)]), other), null);
});

test("a receipt backing the one charge it equals is not a payment plan", () => {
  const cvsReceipt = doc(
    "cvs",
    {
      extracted_amount: 23.47,
      extracted_vendor: "CVS Pharmacy",
      extracted_date: "2026-01-10",
    },
    { backs: [backing("old", 23.47, "CVS/PHARMACY #04417")] },
  );
  const nextCvs: Charge = {
    invoiceId: "this",
    paidDate: "2026-09-15",
    amounts: [12],
    providerNames: ["CVS/PHARMACY #04417"],
  };
  assert.equal(matchReason(cvsReceipt, nextCvs), null);
});

test("provider names: bank text varies, the provider doesn't", () => {
  assert.equal(providerKey("MERCY HOSP PMT 0923"), "mercy hosp");
  assert.equal(providerKey("SQ *SMILE DENTAL 8842"), "smile dental");
  assert.ok(sameProvider(["MERCY HOSP PMT 0923"], ["MERCY HOSP PMT 1023"]));
  assert.ok(sameProvider(["SQ *SMILE DENTAL 8842"], ["Smile Dental Group"]));
  assert.ok(!sameProvider(["Smile Dental"], ["Mercy Hospital"]));
  // Too short to trust as part of a longer name.
  assert.ok(!sameProvider(["ABC"], ["ABC Hospital"]));
});

// ── Ordering and the offer ─────────────────────────────────────────────────

test("picker: amount matches by nearest date, then plans, then the rest", () => {
  const far = doc("far", {
    extracted_amount: 85,
    extracted_date: "2026-09-01",
  });
  const near = doc("near", {
    extracted_amount: 85,
    extracted_date: "2026-09-14",
  });
  const plan = doc(
    "plan",
    { extracted_amount: 900, extracted_vendor: "Smile Dental Group" },
    { backs: [backing("p1", 85, "SQ *SMILE DENTAL 8842")] },
  );
  const old = doc("old", null, { uploaded_at: "2026-01-01T00:00:00Z" });
  const recent = doc("recent", null, { uploaded_at: "2026-09-20T00:00:00Z" });
  const { matches, rest } = rankForPicker(
    [old, plan, far, recent, near],
    charge,
  );
  assert.deepEqual(
    matches.map((d) => d.id),
    ["near", "far", "plan"],
  );
  assert.deepEqual(
    rest.map((d) => d.id),
    ["recent", "old"],
  );
});

test("picker with no charge (attaching to several expenses) ranks nothing", () => {
  const d = doc("a", { extracted_amount: 85, extracted_date: "2026-09-15" });
  assert.deepEqual(rankForPicker([d], null).matches, []);
});

test("the offer lists every match: two photos of one receipt are both offered", () => {
  const one = doc("one", {
    extracted_amount: 85,
    extracted_date: "2026-09-15",
  });
  const two = doc("two", {
    extracted_amount: 85,
    extracted_date: "2026-09-15",
  });
  const other = doc("other", {
    extracted_amount: 12,
    extracted_date: "2026-09-15",
  });
  assert.deepEqual(
    likelyMatches([one, other], charge).map((d) => d.id),
    ["one"],
  );
  assert.equal(likelyMatches([one, two, other], charge).length, 2);
  assert.deepEqual(likelyMatches([other], charge), []);
});

// ── Catch-up ───────────────────────────────────────────────────────────────

test("catch-up: unread documents on no expense, oldest first, capped", () => {
  const d = (
    id: string,
    day: string,
    scan: unknown,
    backs: unknown[] = [],
  ) => ({
    id,
    uploaded_at: `2026-09-${day}T00:00:00Z`,
    scan,
    backs,
  });
  const docs = [
    d("new", "20", null),
    d("old", "01", null),
    d("read", "02", { scan_status: "read" }),
    d("unreadable", "03", { scan_status: "unreadable" }),
    d("attached", "04", null, [{}]),
    d("mid", "10", null),
  ];
  assert.deepEqual(
    documentsToCatchUp(docs, new Set()).map((x) => x.id),
    ["old", "mid", "new"],
  );
  // Already tried this visit: not again.
  assert.deepEqual(
    documentsToCatchUp(docs, new Set(["old"])).map((x) => x.id),
    ["mid", "new"],
  );
  // The cap counts what the catch-up tried...
  assert.deepEqual(
    documentsToCatchUp(docs, new Set(["x"]), new Set(), 2).map((x) => x.id),
    ["old"],
  );
  // ...but not what an upload claimed, which is only skipped.
  assert.deepEqual(
    documentsToCatchUp(docs, new Set(), new Set(["old", "u1", "u2"]), 2).map(
      (x) => x.id,
    ),
    ["mid", "new"],
  );
});
