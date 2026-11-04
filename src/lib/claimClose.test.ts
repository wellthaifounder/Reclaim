// Run with `npm test` (node --test). Launch plan L3, Batch 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAmountReceived,
  explainCloseFailure,
  notClaimableBreakdown,
  remainingOf,
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
  assert.deepEqual(checkAmountReceived("200.00", 200, 2), {
    ok: true,
    amount: 200,
    shortfall: 0,
  });
  assert.deepEqual(checkAmountReceived("$1,200", 1200, 3), {
    ok: true,
    amount: 1200,
    shortfall: 0,
  });
});

test("amount received: short on a one-expense claim reports the shortfall", () => {
  assert.deepEqual(checkAmountReceived("200", 250, 1), {
    ok: true,
    amount: 200,
    shortfall: 50,
  });
  // Cents survive without floating-point dust.
  assert.deepEqual(checkAmountReceived("0.10", 0.3, 1), {
    ok: true,
    amount: 0.1,
    shortfall: 0.2,
  });
});

test("amount received: refusals match the database", () => {
  for (const bad of ["", "abc", "-5", "1.234", "1e3"]) {
    assert.equal(checkAmountReceived(bad, 100, 1).ok, false, bad);
  }
  assert.equal(checkAmountReceived("0", 100, 1).ok, false);
  assert.equal(checkAmountReceived("100.01", 100, 1).ok, false);
  // Short on a several-expense claim waits on the split decision.
  assert.equal(checkAmountReceived("90", 100, 2).ok, false);
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
