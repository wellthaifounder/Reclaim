// Which Plaid environment this deployment talks to.
//
// Why this exists: five functions each carried their own copy of
//
//   const env = Deno.env.get("PLAID_ENV") || "sandbox";
//   return urls[env] || urls["sandbox"];
//
// which fails to sandbox twice over -- once if the variable is unset, again if
// it holds anything unrecognised. Both failures are silent, and the thing they
// fail *into* is the one environment where nothing is real.
//
// That is not a hypothetical. On 2026-08-27 the live site at
// www.wellth-ai.app was serving Plaid's sandbox to real visitors: the bank
// picker offered "First Platypus Bank" instead of Chase, and every balance and
// transaction behind it was fiction. Nothing logged a warning, because from the
// code's point of view nothing had gone wrong -- it had taken its default. For
// an app whose entire premise is reading your real bank history, a silent
// default to fake data is the worst possible direction to fail in.
//
// So: no fallback. An unset or unrecognised PLAID_ENV throws, and the caller
// turns that into a 500. A loud outage is recoverable in minutes; users
// unknowingly connecting to fake banks is not, and can go unnoticed for weeks.

export type PlaidEnv = "sandbox" | "production";

const PLAID_BASE_URLS: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/**
 * Resolve PLAID_ENV, or throw.
 *
 * Note `development` is deliberately absent. Plaid retired that environment;
 * development.plaid.com no longer answers, so accepting the value would only
 * trade this clear error for an opaque network failure later.
 */
export function resolvePlaidEnv(): PlaidEnv {
  const raw = Deno.env.get("PLAID_ENV");

  if (!raw || raw.trim() === "") {
    throw new Error(
      "PLAID_ENV is not set. Set it to 'sandbox' or 'production' in the " +
        "Supabase edge function secrets. There is deliberately no default: " +
        "defaulting would silently point real users at fake bank data.",
    );
  }

  const env = raw.trim().toLowerCase();
  if (env === "sandbox" || env === "production") {
    return env;
  }

  if (env === "development") {
    throw new Error(
      "PLAID_ENV is 'development', an environment Plaid has retired. " +
        "Use 'sandbox' or 'production'.",
    );
  }

  throw new Error(
    `PLAID_ENV is '${raw}', which is not a Plaid environment. ` +
      "Use 'sandbox' or 'production'. Note the value is case-insensitive but " +
      "must otherwise match exactly -- 'prod' and 'live' are not accepted.",
  );
}

/** Base URL for the configured environment. Throws if it is not configured. */
export function plaidBaseUrl(): string {
  return PLAID_BASE_URLS[resolvePlaidEnv()];
}
