// Reclaim — Plaid webhook signature verification.
//
// Plaid signs webhooks with an ES256 JWT in the `plaid-verification` header.
// The JWT body's `request_body_sha256` claim must match SHA-256(raw body)
// hex-encoded. The signing key is published per `kid` via Plaid's
// /webhook_verification_key/get endpoint.
//
// Reference: https://plaid.com/docs/api/webhooks/webhook-verification/

export interface VerificationOptions {
  plaidEnv: "sandbox" | "development" | "production";
  plaidClientId: string;
  plaidSecret: string;
  /**
   * Maximum age of the verification JWT in seconds. Plaid uses ~5 minutes
   * elsewhere; we mirror that as a replay-attack guardrail.
   */
  maxAgeSeconds?: number;
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
}

function plaidBaseUrl(env: VerificationOptions["plaidEnv"]): string {
  return {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  }[env];
}

// Cache resolved JWKs per kid for the lifetime of the worker.
const keyCache = new Map<string, CryptoKey>();

function base64UrlToUint8(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function base64UrlDecodeJson(s: string): Record<string, unknown> {
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(base64UrlToUint8(s)));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importEcJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

async function fetchPlaidKey(
  kid: string,
  opts: VerificationOptions,
): Promise<CryptoKey | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const res = await fetch(
    `${plaidBaseUrl(opts.plaidEnv)}/webhook_verification_key/get`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: opts.plaidClientId,
        secret: opts.plaidSecret,
        key_id: kid,
      }),
    },
  );
  if (!res.ok) {
    console.warn(
      "[plaidWebhookVerification] /webhook_verification_key/get failed:",
      res.status,
    );
    return null;
  }
  const body = await res.json();
  // Plaid returns { key: { kid, kty, crv, x, y, ...expired_at } }
  const jwk = body.key as JsonWebKey & { expired_at?: string | null };
  if (jwk.expired_at) {
    console.warn(
      "[plaidWebhookVerification] Plaid key",
      kid,
      "is rotated (expired_at=",
      jwk.expired_at,
      ")",
    );
  }
  const key = await importEcJwk(jwk);
  keyCache.set(kid, key);
  return key;
}

/**
 * Verify the Plaid webhook signature.
 *
 * @param verificationHeader  Value of the `plaid-verification` header
 * @param rawBody             The raw request body (must be the EXACT bytes Plaid sent — do not re-stringify)
 * @param opts                Plaid env + credentials
 */
export async function verifyPlaidWebhook(
  verificationHeader: string | null,
  rawBody: string,
  opts: VerificationOptions,
): Promise<VerificationResult> {
  if (!verificationHeader) {
    return { ok: false, reason: "missing plaid-verification header" };
  }
  const parts = verificationHeader.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed JWT" };
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = base64UrlDecodeJson(headerB64);
    payload = base64UrlDecodeJson(payloadB64);
  } catch {
    return { ok: false, reason: "JWT base64 decode failed" };
  }

  if (header.alg !== "ES256") {
    return { ok: false, reason: `unexpected alg ${String(header.alg)}` };
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  if (!kid) {
    return { ok: false, reason: "missing kid in JWT header" };
  }

  // Replay guardrail: reject stale tokens.
  const maxAge = opts.maxAgeSeconds ?? 5 * 60;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  if (iat == null) {
    return { ok: false, reason: "missing iat claim" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - iat > maxAge) {
    return { ok: false, reason: `JWT too old (${nowSec - iat}s)` };
  }

  // Body integrity: hash must match.
  const claimedHash = payload.request_body_sha256;
  if (typeof claimedHash !== "string") {
    return { ok: false, reason: "missing request_body_sha256 claim" };
  }
  const actualHash = await sha256Hex(rawBody);
  if (claimedHash !== actualHash) {
    return { ok: false, reason: "request body hash mismatch" };
  }

  // Signature verification with Plaid's public key.
  const key = await fetchPlaidKey(kid, opts);
  if (!key) {
    return { ok: false, reason: "could not resolve Plaid signing key" };
  }
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8(signatureB64);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    signingInput,
  );
  if (!valid) {
    return { ok: false, reason: "signature verification failed" };
  }

  return { ok: true };
}
