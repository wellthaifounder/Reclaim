// Turning a failed create-checkout call into something a person can act on.
//
// supabase-js throws a FunctionsHttpError for any non-2xx answer, and puts the
// actual HTTP response on `.context`. The checkout button used to catch that,
// throw the response away and show one fixed sentence -- so a session that had
// expired, a Stripe outage and a misconfigured account all read identically,
// and the person could neither fix the first nor usefully report the others.
//
// create-checkout answers failures as { error, code, request_id }, where `error`
// is a fixed, safe sentence chosen server-side. This reads that back.

export interface CheckoutFailureDetails {
  /** Server's failure code, or NETWORK / AUTH when derived from the transport. */
  code: string | null;
  /** The server's own safe sentence, when it sent one. */
  message: string | null;
  /** Ties this failure to exactly one server log line. */
  requestId: string | null;
  status: number | null;
}

const NOTHING: CheckoutFailureDetails = {
  code: null,
  message: null,
  requestId: null,
  status: null,
};

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

/** Pull what the server said out of whatever supabase-js threw. */
export async function readCheckoutFailure(
  error: unknown,
): Promise<CheckoutFailureDetails> {
  if (typeof error !== "object" || error === null) return NOTHING;
  const e = error as { name?: unknown; context?: unknown };

  // The request never got an answer: offline, blocked, or a CORS failure.
  if (e.name === "FunctionsFetchError") {
    return { ...NOTHING, code: "NETWORK" };
  }

  if (!isResponse(e.context)) return NOTHING;
  const status = e.context.status;

  let body: unknown = null;
  try {
    // clone(): the body can only be read once and something else may want it.
    body = await e.context.clone().json();
  } catch {
    // Not JSON -- a gateway page, or an empty body. The status still says a lot.
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);

  return {
    // A 401 from the Supabase gateway (before our function ran) carries its own
    // vocabulary of codes; all of them mean the same thing to the person.
    code: status === 401 ? "AUTH" : str(b.code),
    message: str(b.error),
    requestId: str(b.request_id),
    status,
  };
}

const FALLBACKS: Record<string, string> = {
  AUTH: "Your session has expired. Please sign in again.",
  NETWORK:
    "We couldn't reach the server. Check your connection and try again. You haven't been charged.",
};

const GENERIC =
  "Something went wrong starting checkout. You haven't been charged. Please try again.";

/**
 * The toast to show. Prefers the server's sentence (it knows the failure), then
 * a fallback for transport-level failures, then a generic line -- and always
 * ends with the short reference when there is one, because "it failed" is not
 * something support can look up and a reference is.
 */
export function checkoutFailureMessage(d: CheckoutFailureDetails): string {
  const base = d.message ?? (d.code && FALLBACKS[d.code]) ?? GENERIC;
  return d.requestId ? `${base} (Ref ${d.requestId.slice(0, 8)})` : base;
}

/** Only ever send the browser to an https address. */
export function isSafeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
