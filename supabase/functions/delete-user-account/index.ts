import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPlaidToken } from "../_shared/encryption.ts";
import { plaidBaseUrl } from "../_shared/plaidEnv.ts";

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
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Deliberately the ONE Plaid caller that does not propagate a bad PLAID_ENV.
//
// Everywhere else a misconfigured environment must fail loudly rather than
// silently talk to sandbox (see _shared/plaidEnv.ts). Here the priority
// inverts: deleting your account is a right, and it must not be blocked
// because a Plaid setting is wrong. This mirrors the existing per-connection
// behaviour below, which already logs and continues when revocation fails --
// the deletion is what matters, and an un-revoked Plaid item is a smaller
// problem than an account nobody can erase.
//
// Returning null means "skip revocation", not "use a default".
const getPlaidUrlOrNull = (): string | null => {
  try {
    return plaidBaseUrl();
  } catch (err) {
    console.error(
      "[delete-user-account] Cannot resolve Plaid environment; skipping item revocation and continuing with deletion:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  // 1. Authenticate the caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Require explicit confirmation in the request body to prevent accidental calls
    const body = await req.json().catch(() => ({}));
    if (body?.confirmation !== "DELETE MY ACCOUNT") {
      return new Response(
        JSON.stringify({ error: "Confirmation phrase required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Revoke all Plaid connections for this user
    const { data: connections } = await supabaseAdmin
      .from("plaid_connections")
      .select("id, encrypted_access_token")
      .eq("user_id", user.id);

    const plaidApiUrl = getPlaidUrlOrNull();
    if (connections && connections.length > 0 && plaidApiUrl) {
      const plaidClientId = Deno.env.get("PLAID_CLIENT_ID");
      const plaidSecret = Deno.env.get("PLAID_SECRET");

      for (const conn of connections) {
        try {
          const accessToken = await decryptPlaidToken(
            conn.encrypted_access_token,
          );
          const removeResp = await fetch(`${plaidApiUrl}/item/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: plaidClientId,
              secret: plaidSecret,
              access_token: accessToken,
            }),
          });
          if (!removeResp.ok) {
            console.error(
              `[${requestId}] Plaid /item/remove failed for connection ${conn.id}: status ${removeResp.status}`,
            );
          }
        } catch (err) {
          console.error(
            `[${requestId}] Failed to revoke Plaid item ${conn.id}:`,
            err instanceof Error ? err.message : err,
          );
          // Continue — we still want to delete the DB record even if Plaid revocation fails
        }
      }
    }

    // 3. Delete the auth.users row. ON DELETE CASCADE on foreign keys to
    //    auth.users(id) removes the user's owned rows across the schema.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(
      user.id,
    );

    if (deleteError) {
      console.error(
        `[${requestId}] Failed to delete user ${user.id}:`,
        deleteError.message,
      );
      return new Response(
        JSON.stringify({
          error: "Account deletion failed. Please contact support.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[${requestId}] Account deletion completed for user ${user.id}`,
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `[${requestId}] delete-user-account error:`,
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred. Please try again.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
