// Run with `npm test` (node --test). Batch 3: signup and save errors.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeExpenseSaveError,
  GENERIC_SAVE_FAILURE,
  isConnectionProblem,
} from "./expenseSaveErrors.ts";
import {
  isRateLimited,
  describeResendError,
  describeSignupError,
  EMAIL_TAKEN_MESSAGE,
  GENERIC_SIGNUP_FAILURE,
} from "./signupErrors.ts";

// ── Expense saves ───────────────────────────────────────────────────────────

test("an amount the column cannot hold is pinned on the amount field", () => {
  const p = describeExpenseSaveError({
    code: "22003",
    message: "numeric field overflow",
  });
  assert.equal(p.field, "amount");
});

test("a blank patient id (the audited failure) is pinned on the patient", () => {
  const p = describeExpenseSaveError({
    code: "22P02",
    message: 'invalid input syntax for type uuid: ""',
  });
  assert.equal(p.field, "patientId");
});

test("a malformed date is pinned on the date", () => {
  assert.equal(
    describeExpenseSaveError({ code: "22007", message: "x" }).field,
    "date",
  );
});

test("an expired session is a form-level message", () => {
  const p = describeExpenseSaveError({
    code: "PGRST301",
    message: "JWT expired",
  });
  assert.equal(p.field, null);
  assert.match(p.message, /Sign in again/);
});

test("a dropped connection is a form-level message", () => {
  const p = describeExpenseSaveError(new TypeError("Failed to fetch"));
  assert.equal(p.field, null);
  assert.match(p.message, /connection/);
});

test("an unrecognised failure shows only the generic line, never the server text", () => {
  const secret = "constraint violated for patient Jane Doe, diagnosis diabetes";
  const p = describeExpenseSaveError({ code: "XX000", message: secret });
  assert.equal(p.field, null);
  assert.equal(p.message, GENERIC_SAVE_FAILURE);
  assert.ok(!p.message.includes("Jane"));
});

test("no expense message ever repeats the raw error text", () => {
  const raw = 'invalid input syntax for type uuid: "Jane Doe"';
  for (const code of ["22003", "22007", "22P02", "23503", "PGRST301", "XX"]) {
    const p = describeExpenseSaveError({ code, message: raw });
    assert.ok(!p.message.includes("Jane"), code);
    assert.ok(!p.message.includes("uuid"), code);
  }
});

test("non-object failures do not throw", () => {
  assert.equal(
    describeExpenseSaveError(undefined).message,
    GENERIC_SAVE_FAILURE,
  );
  assert.equal(describeExpenseSaveError("boom").message, GENERIC_SAVE_FAILURE);
  assert.equal(describeExpenseSaveError(null).message, GENERIC_SAVE_FAILURE);
});

// ── Sign-up ─────────────────────────────────────────────────────────────────

test("a taken address is pinned on the email field", () => {
  const byCode = describeSignupError({ code: "user_already_exists" });
  assert.deepEqual(byCode, { field: "email", message: EMAIL_TAKEN_MESSAGE });
  const bySentence = describeSignupError({
    message: "User already registered",
  });
  assert.equal(bySentence.field, "email");
});

test("a rejected address is pinned on the email field", () => {
  assert.equal(
    describeSignupError({ code: "email_address_invalid" }).field,
    "email",
  );
});

test("a weak password is pinned on the password field, by reason", () => {
  const breached = describeSignupError({
    code: "weak_password",
    reasons: ["pwned"],
  });
  assert.equal(breached.field, "password");
  assert.match(breached.message, /breach/);
  const chars = describeSignupError({
    code: "weak_password",
    reasons: ["characters"],
  });
  assert.match(chars.message, /upper and lower/);
  assert.equal(
    describeSignupError({ code: "weak_password" }).message,
    "Choose a stronger password.",
  );
});

test("rate limiting is a form-level message", () => {
  const p = describeSignupError({ code: "over_email_send_rate_limit" });
  assert.equal(p.field, null);
  assert.match(p.message, /Too many/);
  assert.equal(describeSignupError({ status: 429 }).field, null);
});

test("an unrecognised sign-up failure shows only the generic line", () => {
  const p = describeSignupError({
    code: "unexpected_failure",
    message: "Database error saving new user for jane@example.com",
  });
  assert.deepEqual(p, { field: null, message: GENERIC_SIGNUP_FAILURE });
});

test("resend failures name the wait for a rate limit and nothing else", () => {
  assert.match(
    describeResendError({ code: "over_email_send_rate_limit" }),
    /minute/,
  );
  assert.ok(
    !describeResendError({
      message: "smtp host mail.internal refused",
    }).includes("smtp"),
  );
});

// ── Round 1 ─────────────────────────────────────────────────────────────────

test("a dropped network is a connection problem, an expired session is not", () => {
  assert.equal(
    isConnectionProblem({ name: "AuthRetryableFetchError", message: "x" }),
    true,
  );
  assert.equal(isConnectionProblem(new TypeError("Failed to fetch")), true);
  assert.equal(
    isConnectionProblem({
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    }),
    false,
  );
  assert.equal(isConnectionProblem(null), false);
  assert.equal(isConnectionProblem("boom"), false);
});

test("rate limiting is recognised by code or status", () => {
  assert.equal(isRateLimited({ code: "over_email_send_rate_limit" }), true);
  assert.equal(isRateLimited({ status: 429 }), true);
  assert.equal(isRateLimited({ code: "weak_password" }), false);
  assert.equal(isRateLimited(undefined), false);
});
