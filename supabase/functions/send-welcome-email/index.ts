import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Resend from "https://esm.sh/resend@2.0.0";

// Reclaim — welcome email on signup. Auth-gated and self-addressed: it only
// ever emails the authenticated caller's own address, so it takes no body and
// cannot be used to spray mail. Best-effort from the client (failures must not
// block signup). Follows the canonical edge-function template (JWT validate,
// dynamic CORS, generic errors).

// ── CORS ──────────────────────────────────────────────────────────────────────
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

function buildWelcomeEmail(userName: string): {
  subject: string;
  html: string;
} {
  const subject = "Welcome to Reclaim 🎉";
  const html = `
    <h2>Welcome to Reclaim, ${userName}!</h2>
    <p>You're all set. Reclaim helps you find healthcare expenses you can still
    reimburse from your HSA — and builds the IRS-ready paper trail to back them up.</p>
    <p>Three steps to your first reclaim:</p>
    <ol>
      <li><strong>Snap a receipt</strong> or connect your bank to import expenses.</li>
      <li><strong>Confirm eligibility</strong> in your review queue.</li>
      <li><strong>Generate a Substantiation Record</strong> when you're ready to reimburse.</li>
    </ol>
    <p>Log in any time to pick up where you left off.</p>
    <p>Best regards,<br>The Reclaim Team</p>
  `;
  return { subject, html };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  // 1. Authenticate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const userEmail = user.email;
    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "User email not available." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      throw new Error("RESEND_API_KEY not configured");
    }
    const resend = new Resend.Resend(resendKey);

    const userName =
      (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
      "there";
    const { subject, html } = buildWelcomeEmail(userName);

    await resend.emails.send({
      from: "Reclaim <notifications@wellth-ai.app>",
      to: [userEmail],
      subject,
      html,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      "[send-welcome-email] Error:",
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
