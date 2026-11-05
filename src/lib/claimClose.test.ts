// Run with `npm test` (node --test). Launch plan L3, Batch 2; oldest-first
// split per the founder's decision of 2026-11-04.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAmountReceived,
  explainCloseFailure,
  notClaimableBreakdown,
  remainingOf,
  shortfallByExpense,
} from "./claimClose.ts";

test("remaining: reimbursable less reimbursed, falling back to paid then billed", () => {
  assert.equal(remainingOf({ amount: 250, reimbursed_amount: 200 }), 50);
  assert.equal(
    remainingOf({ amount: 250, amount_paid: 240, reimbursed_amount: 0 }),
    240,
  );
  assert.equal(
    remainingOf({
      amount: 250,
      amount_paid: 240,
      reimbursable_amount: "180.10",
      reimbursed_amount: "100.05",
    }),
    80.05,
  );
  // Never negative.
  assert.equal(remainingOf({ amount: 50, reimbursed_amount: 60 }), 0);
});

test("amount received: the pre-filled claim total is paid in full", () => {
  assert.deepEqual(checkAmountReceived("200.00", 200), {
    ok: true,
    amount: 200,
    shortfall: 0,
  });
  assert.deepEqual(checkAmountReceived("$1,200", 1200), {
    ok: true,
    amount: 1200,
    shortfall: 0,
  });
});

test("amount received: a short payment reports the shortfall", () => {
  assert.deepEqual(checkAmountReceived("200", 250), {
    ok: true,
    amount: 200,
    shortfall: 50,
  });
  // Cents survive without floating-point dust.
  assert.deepEqual(checkAmountReceived("0.10", 0.3), {
    ok: true,
    amount: 0.1,
    shortfall: 0.2,
  });
  // Several expenses: allowed now (founder 2026-11-04, oldest first).
  assert.equal(checkAmountReceived("90", 100).ok, true);
});

test("amount received: refusals match the database", () => {
  for (const bad of ["", "abc", "-5", "1.234", "1e3"]) {
    assert.equal(checkAmountReceived(bad, 100).ok, false, bad);
  }
  assert.equal(checkAmountReceived("0", 100).ok, false);
  assert.equal(checkAmountReceived("100.01", 100).ok, false);
});

const dental = {
  invoiceId: "a",
  label: "Dental",
  claimed: 120,
  serviceDate: "2026-03-02",
  createdAt: "2026-11-04T09:00:00+00:00",
};
const eye = {
  invoiceId: "b",
  label: "Eye exam",
  claimed: 80,
  serviceDate: "2026-04-10",
  createdAt: "2026-11-04T08:00:00+00:00",
};
const lab = {
  invoiceId: "c",
  label: "Lab",
  claimed: 40,
  serviceDate: "2026-07-20",
  createdAt: "2026-11-04T07:00:00+00:00",
};

test("oldest first: the shortfall lands on the newest expense", () => {
  // Listed newest first on purpose: order comes from the date of care.
  assert.deepEqual(shortfallByExpense([eye, dental], 150), [
    { invoiceId: "b", label: "Eye exam", backToClaim: 50 },
  ]);
});

test("oldest first: a larger shortfall leaves two expenses owing", () => {
  // $150 of $240: Dental (oldest) paid in full, Eye gets $30, Lab nothing.
  assert.deepEqual(shortfallByExpense([lab, eye, dental], 150), [
    { invoiceId: "b", label: "Eye exam", backToClaim: 50 },
    { invoiceId: "c", label: "Lab", backToClaim: 40 },
  ]);
});

test("oldest first: paid in full leaves nothing owing; ties fall to created_at", () => {
  assert.deepEqual(shortfallByExpense([dental, eye], 200), []);
  const sameDay = { ...eye, serviceDate: dental.serviceDate };
  // Same date of care: eye was created first, so it is paid first.
  assert.deepEqual(shortfallByExpense([dental, sameDay], 100), [
    { invoiceId: "a", label: "Dental", backToClaim: 100 },
  ]);
});

test("close failures are explained, never shown raw", () => {
  assert.match(
    explainCloseFailure("CLOSE_WRONG_STATUS: RCM-2026-0001 is reimbursed"),
    /already moved on/,
  );
  assert.match(
    explainCloseFailure("CLOSE_NOT_FOUND: that claim does not exist"),
    /could not be found/,
  );
  assert.match(explainCloseFailure("something else"), /Please try again/);
});

test("not-claimable breakdown separates sent claims from HSA-card spend", () => {
  assert.deepEqual(
    notClaimableBreakdown([
      { claimable: true, claimState: "unclaimed" },
      { claimable: false, claimState: "locked_in_request" },
      { claimable: false, claimState: "locked_in_request" },
      { claimable: false, claimState: "not_reimbursable" },
      { claimable: false, claimState: "reimbursed" },
    ]),
    { inSentClaim: 2, paidByHsaCard: 1, reimbursed: 1 },
  );
});
