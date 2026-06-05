import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptPlaidToken } from "../_shared/encryption.ts";

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
    const { public_token } = await req.json();

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

    console.log(`[${requestId}] Exchanging public token using ${plaidBaseUrl}`);

    // Exchange public token for access token
    const exchangeResponse = await fetch(
      `${plaidBaseUrl}/item/public_token/exchange`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: plaidClientId,
          secret: plaidSecretKey,
          public_token,
        }),
      },
    );

    const exchangeData = await exchangeResponse.json();

    if (!exchangeResponse.ok) {
      console.error("Plaid exchange error:", exchangeData);
      throw new Error(exchangeData.error_message || "Failed to exchange token");
    }

    const { access_token, item_id } = exchangeData;

    // Get account info
    const accountsResponse = await fetch(`${plaidBaseUrl}/accounts/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: plaidClientId,
        secret: plaidSecretKey,
        access_token,
      }),
    });

    const accountsData = await accountsResponse.json();

    if (!accountsResponse.ok) {
      console.error("Plaid accounts error:", accountsData);
      throw new Error(accountsData.error_message || "Failed to get accounts");
    }

    console.log(
      `[${requestId}] Successfully retrieved accounts:`,
      accountsData.accounts.length,
    );

    // Encrypt the access token before storing
    console.log(`[${requestId}] Encrypting Plaid access token`);
    const encryptedToken = await encryptPlaidToken(access_token);

    // Store connection in database with encrypted token
    const institutionName = accountsData.item?.institution_id || "Unknown";
    const { data: connectionRow, error: insertError } = await supabase
      .from("plaid_connections")
      .insert({
        user_id: user.id,
        encrypted_access_token: encryptedToken,
        item_id,
        institution_name: institutionName,
      })
      .select("id")
      .single();

    if (insertError || !connectionRow) {
      console.error("Database insert error:", insertError);
      throw new Error("Failed to store connection");
    }

    // Reclaim Phase 2 W3: return connection_id + institution_name so the
    // frontend can immediately trigger the 18-month historical pull and
    // render the activation-moment screen.
    return new Response(
      JSON.stringify({
        success: true,
        connection_id: connectionRow.id,
        institution_name: institutionName,
        accounts: accountsData.accounts,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in plaid-exchange-token:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Failed to connect bank account. Please try again.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
