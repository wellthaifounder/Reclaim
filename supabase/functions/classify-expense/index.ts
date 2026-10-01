// Reclaim — classify-expense edge function.
//
// Thin auth-wrapper around _shared/expenseClassifier.ts. Frontend calls this
// (fire-and-forget) after the wizard or manual-entry form saves an invoice;
// the user's review queue picks up whatever lifecycle_status the classifier
// lands on.
//
// Auth model: user JWT required (verify_jwt = true in config.toml — the
// canonical pattern). RLS scopes the invoice fetch to the caller's own
// rows automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.22.4";
import {
  classifyAndPersist,
  type ExpenseInput,
} from "../_shared/expenseClassifier.ts";
import { loadAttachedScans } from "../_shared/documentScan.ts";

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

const RequestSchema = z.object({
  invoice_id: z.string().uuid(),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    {
      global: { headers: { Authorization: authHeader } },
    },
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
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load invoice via RLS-scoped client — the user can only see their own.
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select(
        "id, user_id, vendor, amount, date, category, notes, patient_name, lifecycle_status",
      )
      .eq("id", parsed.data.invoice_id)
      .maybeSingle();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // What every attached document says, so the check rests on what was
    // bought rather than on the bank's description (SUBSTANTIATE_SPEC S24).
    // Attachment lives in receipt_invoices, not receipts.invoice_id -- a
    // document shared with another expense still feeds the classifier here.
    const input: ExpenseInput = {
      invoiceId: invoice.id,
      vendor: invoice.vendor,
      amount: Number(invoice.amount),
      date: invoice.date,
      category: invoice.category,
      notes: invoice.notes,
      patientName: invoice.patient_name,
      documents: await loadAttachedScans(supabase, invoice.id),
    };

    const result = await classifyAndPersist(supabase, input);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      "[classify-expense] Error:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({
        error: "Classification failed. The expense will stay in CAPTURED.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
