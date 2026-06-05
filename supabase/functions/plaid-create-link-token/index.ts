import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
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
    const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
    const webhookUrl = `https://${projectRef}.functions.supabase.co/plaid-webhook`;

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
        client_name: "Wellth",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        webhook: webhookUrl,
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
