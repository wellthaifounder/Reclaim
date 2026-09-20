// What went wrong in create-checkout, sorted into a small set of codes that are
// safe to hand back to the browser.
//
// Until 2026-09-19 every failure -- a missing Stripe key, a price that does not
// exist in the account, a Stripe outage, a bad session -- collapsed to the same
// "unexpected error" 500. The browser could not tell them apart, and neither
// could anyone reading the log without the whole request in hand, so "checkout
// fails" arrived as a symptom with no way to say which of five different
// problems it was. The code names the *kind* of failure; the request id ties
// the browser's message to the one server log line that has the detail.
//
// Nothing here is user data. Codes are a fixed vocabulary; messages are fixed
// strings. The Stripe error's own message is logged server-side only.

export type CheckoutErrorCode =
  | "AUTH"
  | "BAD_REQUEST"
  | "BILLING_NOT_CONFIGURED"
  | "PLAN_UNAVAILABLE"
  | "BILLING_UNAVAILABLE"
  | "INTERNAL";

export interface ClassifiedFailure {
  code: CheckoutErrorCode;
  status: number;
  /** Safe to show. Says what happened to the user's money and what to do. */
  message: string;
}

/** A failure we raise ourselves, already classified. */
export class CheckoutFailure extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "CheckoutFailure";
  }
}

// One place for the words, so a status and its message cannot drift apart.
const RESPONSES: Record<CheckoutErrorCode, ClassifiedFailure> = {
  AUTH: {
    code: "AUTH",
    status: 401,
    message: "Your session has expired. Please sign in again.",
  },
  BAD_REQUEST: {
    code: "BAD_REQUEST",
    status: 400,
    message: "That plan isn't available.",
  },
  BILLING_NOT_CONFIGURED: {
    code: "BILLING_NOT_CONFIGURED",
    status: 503,
    message:
      "Checkout isn't available right now. You haven't been charged. Please try again shortly.",
  },
  PLAN_UNAVAILABLE: {
    code: "PLAN_UNAVAILABLE",
    status: 503,
    message:
      "That plan can't be purchased right now. You haven't been charged. Please try again shortly.",
  },
  BILLING_UNAVAILABLE: {
    code: "BILLING_UNAVAILABLE",
    status: 502,
    message:
      "Our payment provider didn't respond. You haven't been charged. Please try again in a moment.",
  },
  INTERNAL: {
    code: "INTERNAL",
    status: 500,
    message:
      "Something went wrong starting checkout. You haven't been charged. Please try again.",
  },
};

export function responseFor(code: CheckoutErrorCode): ClassifiedFailure {
  return RESPONSES[code];
}

/** The parts of a stripe-node error worth logging. Never the whole object. */
export interface StripeErrorFacts {
  type: string;
  code: string | null;
  param: string | null;
  statusCode: number | null;
}

/**
 * Read a stripe-node error without importing stripe-node, so this file can be
 * tested with a plain object. stripe-node tags every error with a `type` that
 * begins "Stripe"; anything without one is not a Stripe error.
 */
export function stripeFacts(error: unknown): StripeErrorFacts | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as Record<string, unknown>;
  if (typeof e.type !== "string" || !e.type.startsWith("Stripe")) return null;
  return {
    type: e.type,
    code: typeof e.code === "string" ? e.code : null,
    param: typeof e.param === "string" ? e.param : null,
    statusCode: typeof e.statusCode === "number" ? e.statusCode : null,
  };
}

/**
 * Decide which code a thrown value is.
 *
 * The distinction that matters for whoever gets paged: BILLING_NOT_CONFIGURED
 * and PLAN_UNAVAILABLE are *ours to fix* (a missing/revoked key, a price id that
 * does not exist in the Stripe account the key belongs to -- the classic
 * test-mode-vs-live-mode mismatch), whereas BILLING_UNAVAILABLE is Stripe being
 * unreachable and will clear on its own.
 */
export function classify(error: unknown): ClassifiedFailure {
  if (error instanceof CheckoutFailure) return RESPONSES[error.code];

  const stripe = stripeFacts(error);
  if (!stripe) return RESPONSES.INTERNAL;

  switch (stripe.type) {
    case "StripeAuthenticationError":
    case "StripePermissionError":
      return RESPONSES.BILLING_NOT_CONFIGURED;
    case "StripeInvalidRequestError":
      // resource_missing on a checkout create is the price (or customer) id not
      // existing in this account. Any other invalid-request is a bug in what we
      // sent, which is INTERNAL rather than something to blame on the plan.
      return stripe.code === "resource_missing"
        ? RESPONSES.PLAN_UNAVAILABLE
        : RESPONSES.INTERNAL;
    case "StripeConnectionError":
    case "StripeAPIError":
    case "StripeRateLimitError":
      return RESPONSES.BILLING_UNAVAILABLE;
    default:
      return RESPONSES.INTERNAL;
  }
}

/**
 * What to write to the server log for a failure. Deliberately excludes the
 * user's email, customer ids and the checkout URL: the last is a live link to a
 * payment page, and the first two are identifiers this log has no need of.
 */
export function logFacts(
  error: unknown,
  redact: string[] = [],
): Record<string, unknown> {
  const stripe = stripeFacts(error);
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of redact) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: message.slice(0, 300),
    ...(stripe
      ? {
          stripe_type: stripe.type,
          stripe_code: stripe.code,
          stripe_param: stripe.param,
          stripe_status: stripe.statusCode,
        }
      : {}),
  };
}
