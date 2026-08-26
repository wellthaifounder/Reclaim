import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  "https://reclaim.health",
  "https://www.reclaim.health",
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter(Boolean);

function getCorsHeaders(requestOrigin: string | null) {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[1];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Helper function to get Plaid URL based on environment
const getPlaidUrl = (): string => {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";

  const urls: Record<string, string> = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  };

  return urls[env] || urls["sandbox"];
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestId = crypto.randomUUID();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const plaidClientId = Deno.env.get("PLAID_CLIENT_ID")!;
    const plaidSecretKey = Deno.env.get("PLAID_SECRET")!;
    const plaidBaseUrl = getPlaidUrl();

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error("Auth error:", userError);
      throw new Error("Unauthorized");
    }

    console.log(
      `[${requestId}] Creating Plaid link token using ${plaidBaseUrl}`,
    );

    // Reclaim Phase 2: bind the webhook URL per item at Link-token creation.
    // The Plaid Dashboard "default webhook" UI only lists events for products
    // approved on this account (currently Transfer/Wallet/Bank Income — not
    // Transactions, which we use). Setting the webhook here is independent of
    // dashboard config and works in sandbox today; it will work in production
    // once Transactions production access is granted in Phase 6.
    //
    // We derive the project ref from SUPABASE_URL and build the new
    // `<ref>.functions.supabase.co/<name>` hostname rather than the legacy
    // `<ref>.supabase.co/functions/v1/<name>` pattern — the latter does not
    // resolve as a public hostname for this project (verified 2026-05-24).
    //
    // Against a local stack SUPABASE_URL is `http://kong:8000`, so the ref came
    // out as "kong:8000" and Plaid rejected the whole request with "webhook
    // must be a valid URL string". That made this function — and therefore the
    // entire connect-a-bank flow — impossible to exercise locally, which is
    // why the sync rewrite went unverified for so long. A ref only looks like
    // a real project when it is bare alphanumerics; anything else means we are
    // not running against hosted Supabase and there is no public URL for Plaid
    // to call back to, so we omit the webhook rather than sending a broken one.
    const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
    const webhookUrl = /^[a-z0-9]+$/i.test(projectRef)
      ? `https://${projectRef}.functions.supabase.co/plaid-webhook`
      : null;
    if (!webhookUrl) {
      console.log(
        `[${requestId}] No public webhook URL for host "${projectRef}" — creating link token without one. Expected on a local stack; in production this means SUPABASE_URL is wrong.`,
      );
    }

    // Create Plaid link token
    const response = await fetch(`${plaidBaseUrl}/link/token/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: plaidClientId,
        secret: plaidSecretKey,
        user: {
          client_user_id: user.id,
        },
        client_name: "Reclaim",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        // Omitted entirely when there is no public URL — Plaid rejects a
        // malformed one, and `webhook: null` is itself malformed.
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Plaid API error:", data);
      throw new Error(data.error_message || "Failed to create link token");
    }

    console.log("Successfully created link token");

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in plaid-create-link-token:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Failed to initialize bank connection. Please try again.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
