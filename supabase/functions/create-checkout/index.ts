import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { z } from "https://esm.sh/zod@3.22.4";
import { CheckoutFailure, classify, logFacts } from "./errors.ts";

const allowedOrigins = [
  "https://reclaim.health",
  "https://www.reclaim.health",
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter((o): o is string => Boolean(o));

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

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

// Product IDs for subscription tiers
const TIER_PRICES = {
  plus: "price_1SO9iP2Oq7FyVuCtXz38UjCM",
  premium: "price_1SO9jA2Oq7FyVuCtc2WjHtZd",
};

const RequestSchema = z.object({ tier: z.enum(["plus", "premium"]) });

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // One id per request, minted first so that even a failure before anything else
  // has run can be quoted. It goes to the browser and into the single log line
  // that holds the detail; that pairing is the whole diagnostic story.
  const requestId = crypto.randomUUID();
  // Where in the flow we are, so a failure says which step it died in.
  let stage = "start";
  let userEmail = "";

  try {
    logStep("Function started", { requestId });

    // These were once thrown *outside* the try, which turned a missing
    // environment variable into an unhandled 500 with no body at all.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) throw new CheckoutFailure("INTERNAL");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    stage = "authenticate";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new CheckoutFailure("AUTH");
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData.user?.email) throw new CheckoutFailure("AUTH");
    const user = userData.user;
    userEmail = user.email ?? "";

    stage = "validate";
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new CheckoutFailure("BAD_REQUEST");
    const { tier } = parsed.data;
    logStep("Requested tier", { requestId, tier });

    stage = "configure";
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new CheckoutFailure("BILLING_NOT_CONFIGURED");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    stage = "find_customer";
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });
    const customerId =
      customers.data.length > 0 ? customers.data[0].id : undefined;

    // Return addresses are built from the CORS-checked origin, never from the
    // raw header: this used to interpolate whatever Origin arrived straight
    // into Stripe's success/cancel URLs, including the string "null" when the
    // header was absent -- which Stripe rejects as an invalid URL.
    const returnOrigin = corsHeaders["Access-Control-Allow-Origin"];
    const priceId = TIER_PRICES[tier];

    stage = "create_session";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${returnOrigin}/dashboard?subscription=success`,
      cancel_url: `${returnOrigin}/settings?subscription=cancelled`,
    });

    // The session URL is deliberately not logged: it is a live link to a
    // payment page.
    logStep("Checkout session created", { requestId, tier });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const failure = classify(error);
    logStep("ERROR in create-checkout", {
      requestId,
      stage,
      code: failure.code,
      ...logFacts(error, [userEmail]),
    });
    return new Response(
      JSON.stringify({
        error: failure.message,
        code: failure.code,
        request_id: requestId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: failure.status,
      },
    );
  }
});
