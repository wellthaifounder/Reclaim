import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
      : allowedOrigins[1]; // default to www
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
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY",
    );
  }

  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const requestId = crypto.randomUUID();
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "");
    logStep("Authenticating user with token");

    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser(token);
    if (userError)
      throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email)
      throw new Error("User not authenticated or email not available");
    logStep(`[${requestId}] User authenticated successfully`);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    if (customers.data.length === 0) {
      logStep("No customer found, returning free tier");
      return new Response(
        JSON.stringify({
          subscribed: false,
          tier: "free",
          product_id: null,
          subscription_end: null,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const customerId = customers.data[0].id;
    logStep(`[${requestId}] Stripe customer found`);

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    const hasActiveSub = subscriptions.data.length > 0;
    let productId = null;
    let subscriptionEnd = null;
    let tier = "free";

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];

      // Safely handle subscription end date
      if (subscription.current_period_end) {
        try {
          const requestId = crypto.randomUUID();
          subscriptionEnd = new Date(
            subscription.current_period_end * 1000,
          ).toISOString();
        } catch (dateError) {
          logStep("Error parsing subscription end date", {
            error: dateError,
            raw: subscription.current_period_end,
          });
          subscriptionEnd = null;
        }
      }

      logStep("Active subscription found", {
        subscriptionId: subscription.id,
        endDate: subscriptionEnd,
      });
      productId = subscription.items.data[0].price.product as string;

      // Determine tier based on product ID
      try {
        const requestId = crypto.randomUUID();
        const product = await stripe.products.retrieve(productId);
        logStep(`[${requestId}] Product details retrieved`);

        if (product.name.toLowerCase().includes("premium")) {
          tier = "premium";
        } else if (product.name.toLowerCase().includes("plus")) {
          tier = "plus";
        }
      } catch (productError) {
        logStep("Error retrieving product, defaulting to plus", {
          error: productError,
        });
        tier = "plus";
      }

      logStep("Determined subscription tier", { productId, tier });
    } else {
      logStep("No active subscription found");
    }

    return new Response(
      JSON.stringify({
        subscribed: hasActiveSub,
        tier,
        product_id: productId,
        subscription_end: subscriptionEnd,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred. Please try again.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
