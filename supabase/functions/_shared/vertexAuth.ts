// Vertex AI service-account auth for edge functions.
//
// Mints a Google Cloud OAuth2 access token from a service-account credential so
// edge functions can call Vertex AI — the BAA-covered Gemini endpoint. This
// replaces the direct Google AI Studio API key, which is NOT BAA-eligible.
// Required before any PHI (receipt images, medical expense descriptions) is
// sent to Google's models. See CLAUDE.md "AI Integration".
//
// Secrets (Supabase Edge Function Secrets):
//   GOOGLE_SA_CLIENT_EMAIL   service-account email
//   GOOGLE_SA_PRIVATE_KEY    service-account private key (PEM / PKCS#8)
//   GCP_PROJECT              GCP project id
//   VERTEX_REGION            e.g. "us-central1"
//
// The minted token is cached in module memory for its lifetime (~1h) so a warm
// function instance doesn't re-sign a JWT on every invocation.

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Service-account keys arrive as PEM. When stored in an env var newlines are
// commonly escaped as literal "\n", so normalize those before decoding.
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

async function signJwt(
  clientEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export function getVertexConfig(): { project: string; region: string } {
  const project = Deno.env.get("GCP_PROJECT");
  const region = Deno.env.get("VERTEX_REGION");
  if (!project || !region) {
    throw new Error("GCP_PROJECT / VERTEX_REGION not configured");
  }
  return { project, region };
}

export async function getVertexAccessToken(): Promise<string> {
  // 60s safety margin so we never use a token that expires mid-request.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const clientEmail = Deno.env.get("GOOGLE_SA_CLIENT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
  if (!clientEmail || !privateKey) {
    throw new Error(
      "GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY not configured",
    );
  }

  const assertion = await signJwt(clientEmail, privateKey);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex token exchange failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const token = json.access_token as string;
  const expiresIn = (json.expires_in as number) ?? 3600;
  cached = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

// Vertex AI generateContent endpoint for a given model (e.g. "gemini-2.5-flash").
export function vertexGenerateContentUrl(model: string): string {
  const { project, region } = getVertexConfig();
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:generateContent`;
}
