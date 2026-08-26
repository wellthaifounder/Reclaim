import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Resend from "https://esm.sh/resend@2.0.0";
import { z } from "https://esm.sh/zod@3.22.4";

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

// ── Input schema ──────────────────────────────────────────────────────────────
const RequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reimbursement_update"),
    request_id: z.string().uuid(),
    new_status: z.enum(["pending", "submitted", "approved", "paid"]),
    total_amount: z.number().positive(),
    hsa_provider: z.string().optional(),
  }),
]);

// ── Email builders ────────────────────────────────────────────────────────────
function buildReimbursementUpdateEmail(
  userName: string,
  status: string,
  totalAmount: number,
  hsaProvider?: string,
): { subject: string; html: string } {
  const statusLabels: Record<string, string> = {
    pending: "Pending Review",
    submitted: "Submitted to Provider",
    approved: "Approved",
    paid: "Payment Received",
  };
  const label = statusLabels[status] || status;

  const subject = `HSA Reimbursement Update: ${label}`;
  const html = `
    <h2>Your reimbursement status has been updated</h2>
    <p>Hi ${userName},</p>
    <p>Your HSA reimbursement request for <strong>$${totalAmount.toFixed(2)}</strong> has been updated to <strong>${label}</strong>.</p>
    ${hsaProvider ? `<p>HSA Provider: ${hsaProvider}</p>` : ""}
    ${status === "paid" ? "<p><strong>Your reimbursement has been paid. Check your HSA account balance.</strong></p>" : ""}
    <p>Log in to your Reclaim account to view full details.</p>
    <p>Best regards,<br>The Reclaim Team</p>
  `;
  return { subject, html };
}

// ── Handler ───────────────────────────────────────────────────────────────────
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
    // 2. Validate input
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      throw new Error("RESEND_API_KEY not configured");
    }
    const resend = new Resend.Resend(resendKey);

    const userEmail = user.email;
    const userName = user.user_metadata?.full_name || "there";

    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "User email not available." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Build and send email based on notification type
    const payload = parsed.data;
    let subject = "";
    let html = "";

    if (payload.type === "reimbursement_update") {
      ({ subject, html } = buildReimbursementUpdateEmail(
        userName,
        payload.new_status,
        payload.total_amount,
        payload.hsa_provider,
      ));
    }

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
      "[send-notification] Error:",
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
