import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Named import: the package has no default export, so `import Resend from` and
// the `new Resend.Resend(...)` it forces failed type checking. It happened to
// work at runtime, which is why it survived.
import { Resend } from "https://esm.sh/resend@2.0.0";

// Reclaim — welcome email, sent once, on the first sign-in after the address
// is confirmed.
//
// Auth-gated and self-addressed: it only ever emails the authenticated caller's
// own address, takes no body, and so cannot be used to spray mail. Follows the
// canonical edge-function template (JWT validate, dynamic CORS, generic errors).
//
// IDEMPOTENT BY DESIGN. It used to be called at signup behind
// `if (signUpResult.session)`. Production requires email confirmation, so
// signup returns no session and the call never fired -- every user who has ever
// signed up got silence. The trigger moved to sign-in, which happens every
// time, so this function -- not the client -- decides whether an email is owed:
// it claims profiles.welcome_email_sent_at first and only sends if the claim
// succeeded. Claiming before sending means a race sends one email rather than
// two; releasing the claim when the send fails means a later sign-in retries.

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
  // Copy follows the product as it works now: bank-sync first, receipts second.
  // The previous version led with "snap a receipt", which was the old
  // receipt-first flow and pointed new users at the slowest path in.
  const subject = "Welcome to Reclaim";
  const html = `
    <h2>Welcome to Reclaim, ${userName}</h2>
    <p>Reclaim finds the healthcare costs you paid out of pocket and can still
    reimburse yourself for — and keeps the paper trail the IRS would want.</p>
    <p>Three steps:</p>
    <ol>
      <li><strong>Connect your bank.</strong> Reclaim reads up to 18 months of
      history and picks out the likely medical spending. It is read-only and
      never sees your bank password.</li>
      <li><strong>Confirm what's medical.</strong> You decide; nothing is
      claimed without you.</li>
      <li><strong>Attach documentation and build a claim</strong> whenever
      you're ready. There is no deadline on HSA reimbursement.</li>
    </ol>
    <p>You can also add expenses by hand — mileage and cash payments never
    show up on a bank statement.</p>
    <p>— The Reclaim team</p>
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
  // The caller's Authorization header is forwarded so this client acts AS the
  // signed-in user. Without it the client is anonymous, and the profiles
  // update below is silently refused by row-level security -- which would look
  // exactly like "the welcome email just doesn't work". Least privilege too:
  // this needs to touch one row, its own, so it uses the user's own rights
  // rather than the service role.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
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

    // Claim the send before doing it. The WHERE ... IS NULL makes this a
    // single atomic test-and-set: two simultaneous sign-ins both run it, one
    // updates a row and the other updates none, so exactly one email goes out.
    // Checking first and then writing would leave a window where both pass.
    const { data: claimed, error: claimError } = await supabase
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("welcome_email_sent_at", null)
      .select("id");

    if (claimError) {
      throw claimError;
    }
    if (!claimed || claimed.length === 0) {
      // Already sent, or another request won the race. Not an error: the
      // client calls this on every sign-in and expects to be told no.
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendKey);
    const userName =
      (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
      "there";
    const { subject, html } = buildWelcomeEmail(userName);

    // Resend v2 REPORTS failures, it does not throw them: emails.send resolves
    // to { data, error } and an invalid key, a rejected sender domain or a rate
    // limit all come back as a populated `error` with no exception raised. A
    // try/catch here catches nothing, which is how the original version could
    // report success on an email that was never sent -- and how the release
    // below silently failed to run the first time it was tested. Both the
    // returned error and a genuine throw (network, DNS) have to be handled.
    let sendFailure: unknown = null;
    try {
      const { error: resendError } = await resend.emails.send({
        from: "Reclaim <notifications@wellth-ai.app>",
        to: [userEmail],
        subject,
        html,
      });
      if (resendError) sendFailure = resendError;
    } catch (thrown) {
      sendFailure = thrown;
    }

    if (sendFailure) {
      // Release the claim so the next sign-in tries again. Without this a
      // transient Resend outage costs the user their welcome email
      // permanently, and nothing ever indicates why.
      await supabase
        .from("profiles")
        .update({ welcome_email_sent_at: null })
        .eq("id", user.id);
      throw sendFailure instanceof Error
        ? sendFailure
        : new Error(
            typeof sendFailure === "object" &&
              sendFailure !== null &&
              "message" in sendFailure
              ? String((sendFailure as { message: unknown }).message)
              : "Resend rejected the message",
          );
    }

    return new Response(JSON.stringify({ success: true, sent: true }), {
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
