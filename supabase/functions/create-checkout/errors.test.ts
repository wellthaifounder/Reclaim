// Tests for create-checkout's failure classification.
//
// Run: deno test supabase/functions/create-checkout/errors.test.ts
//
// The shapes below are what stripe-node actually throws: an Error carrying a
// `type` beginning "Stripe", plus `code`, `param` and `statusCode`. They are
// built by hand so the tests need no Stripe key and no network.

import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CheckoutFailure,
  classify,
  logFacts,
  responseFor,
  stripeFacts,
} from "./errors.ts";

const stripeError = (
  type: string,
  extra: { code?: string; param?: string; statusCode?: number } = {},
  message = "stripe said no",
) => Object.assign(new Error(message), { type, ...extra });

Deno.test("our own failures keep the code they were raised with", () => {
  for (const code of [
    "AUTH",
    "BAD_REQUEST",
    "BILLING_NOT_CONFIGURED",
    "INTERNAL",
  ] as const) {
    assertEquals(classify(new CheckoutFailure(code)).code, code);
  }
});

Deno.test("a bad or revoked Stripe key is ours to fix, not the user's", () => {
  assertEquals(
    classify(stripeError("StripeAuthenticationError", { statusCode: 401 }))
      .code,
    "BILLING_NOT_CONFIGURED",
  );
  assertEquals(
    classify(stripeError("StripePermissionError", { statusCode: 403 })).code,
    "BILLING_NOT_CONFIGURED",
  );
});

Deno.test(
  "a price that does not exist in the account is PLAN_UNAVAILABLE",
  () => {
    // The test-mode-key-with-live-mode-price-ids mismatch lands exactly here.
    const err = stripeError("StripeInvalidRequestError", {
      code: "resource_missing",
      param: "line_items[0][price]",
      statusCode: 400,
    });
    assertEquals(classify(err).code, "PLAN_UNAVAILABLE");
  },
);

Deno.test(
  "any other invalid request is a bug on our side, not the plan",
  () => {
    const err = stripeError("StripeInvalidRequestError", {
      code: "url_invalid",
      param: "success_url",
      statusCode: 400,
    });
    assertEquals(classify(err).code, "INTERNAL");
  },
);

Deno.test(
  "Stripe being unreachable is BILLING_UNAVAILABLE and will clear itself",
  () => {
    for (const type of [
      "StripeConnectionError",
      "StripeAPIError",
      "StripeRateLimitError",
    ]) {
      assertEquals(classify(stripeError(type)).code, "BILLING_UNAVAILABLE");
    }
  },
);

Deno.test(
  "anything unrecognised is INTERNAL and never a made-up specific code",
  () => {
    assertEquals(classify(new Error("boom")).code, "INTERNAL");
    assertEquals(classify("a string").code, "INTERNAL");
    assertEquals(classify(null).code, "INTERNAL");
    assertEquals(classify(undefined).code, "INTERNAL");
    // "Stripe" must be a prefix of `type`; a lookalike field is not enough.
    assertEquals(
      classify(Object.assign(new Error("x"), { type: "other" })).code,
      "INTERNAL",
    );
  },
);

Deno.test(
  "every code carries a status and a message, and each status matches its meaning",
  () => {
    assertEquals(responseFor("AUTH").status, 401);
    assertEquals(responseFor("BAD_REQUEST").status, 400);
    assertEquals(responseFor("BILLING_NOT_CONFIGURED").status, 503);
    assertEquals(responseFor("PLAN_UNAVAILABLE").status, 503);
    assertEquals(responseFor("BILLING_UNAVAILABLE").status, 502);
    assertEquals(responseFor("INTERNAL").status, 500);
  },
);

Deno.test("no user-facing message leaks a mechanism", () => {
  const forbidden = /stripe|price_|sk_|key|secret|env|supabase|token/i;
  for (const code of [
    "AUTH",
    "BAD_REQUEST",
    "BILLING_NOT_CONFIGURED",
    "PLAN_UNAVAILABLE",
    "BILLING_UNAVAILABLE",
    "INTERNAL",
  ] as const) {
    assertFalse(
      forbidden.test(responseFor(code).message),
      `${code} message names an internal: ${responseFor(code).message}`,
    );
  }
});

Deno.test(
  "every failure that follows a charge attempt tells the user nothing was charged",
  () => {
    // Failures happen before Stripe creates a session, so this is true -- and it
    // is the first thing someone staring at an error wants to know.
    for (const code of [
      "BILLING_NOT_CONFIGURED",
      "PLAN_UNAVAILABLE",
      "BILLING_UNAVAILABLE",
      "INTERNAL",
    ] as const) {
      assertEquals(
        responseFor(code).message.includes("haven't been charged"),
        true,
        code,
      );
    }
  },
);

Deno.test("stripeFacts reads only the fields worth logging", () => {
  const facts = stripeFacts(
    stripeError("StripeInvalidRequestError", {
      code: "resource_missing",
      param: "line_items[0][price]",
      statusCode: 400,
    }),
  );
  assertEquals(facts, {
    type: "StripeInvalidRequestError",
    code: "resource_missing",
    param: "line_items[0][price]",
    statusCode: 400,
  });
  assertEquals(stripeFacts(new Error("plain")), null);
  assertEquals(stripeFacts(42), null);
});

Deno.test(
  "logFacts redacts the user's email and truncates long messages",
  () => {
    const email = "someone@example.com";
    const facts = logFacts(
      stripeError(
        "StripeInvalidRequestError",
        { code: "email_invalid" },
        `Invalid email address: ${email}`,
      ),
      [email],
    );
    assertEquals(String(facts.message).includes(email), false);
    assertEquals(String(facts.message).includes("[redacted]"), true);
    assertEquals(facts.stripe_code, "email_invalid");

    const long = logFacts(new Error("x".repeat(5000)));
    assertEquals(String(long.message).length, 300);
  },
);

Deno.test("logFacts on a non-Stripe error carries no stripe_* fields", () => {
  const facts = logFacts(new Error("plain"));
  assertEquals("stripe_type" in facts, false);
  assertEquals(facts.name, "Error");
});
