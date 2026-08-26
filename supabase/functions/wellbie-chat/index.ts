import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { z } from "https://esm.sh/zod@3.22.4";

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

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(10000),
      }),
    )
    .max(50),
  context: z.record(z.unknown()).optional(),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const validation = RequestSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request format." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const { messages, context } = validation.data;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build bill analysis context section if available
    let billAnalysisSection = "";
    if (context?.billAnalysis) {
      const analysis = context.billAnalysis;
      const formatConfidence = (conf: number) => {
        if (conf >= 0.9) return "✅";
        if (conf >= 0.7) return "⚠️";
        return "❓";
      };

      const metadata = analysis.metadata || {};
      const lowConfidenceFields: string[] = [];
      const extractedFields: string[] = [];

      if (metadata.provider_name?.value) {
        const conf = metadata.provider_name.confidence;
        extractedFields.push(
          `- Provider: ${metadata.provider_name.value} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("provider name");
      }
      if (metadata.total_amount?.value !== undefined) {
        const conf = metadata.total_amount.confidence;
        extractedFields.push(
          `- Amount: $${metadata.total_amount.value.toFixed(2)} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("total amount");
      }
      if (metadata.service_date?.value) {
        const conf = metadata.service_date.confidence;
        extractedFields.push(
          `- Service Date: ${metadata.service_date.value} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("service date");
      }
      if (metadata.bill_date?.value) {
        const conf = metadata.bill_date.confidence;
        extractedFields.push(
          `- Bill Date: ${metadata.bill_date.value} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("bill date");
      }
      if (metadata.category?.value) {
        const conf = metadata.category.confidence;
        extractedFields.push(
          `- Category: ${metadata.category.value} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("category");
      }
      if (metadata.invoice_number?.value) {
        const conf = metadata.invoice_number.confidence;
        extractedFields.push(
          `- Invoice #: ${metadata.invoice_number.value} ${formatConfidence(conf)}`,
        );
        if (conf < 0.9) lowConfidenceFields.push("invoice number");
      }

      billAnalysisSection = `

BILL ANALYSIS RESULTS (Invoice ID: ${context.invoiceId || "pending"}):
Analysis Status: ${analysis.success ? "Completed" : "Failed"}
Overall Confidence: ${analysis.confidenceScore ? (analysis.confidenceScore * 100).toFixed(0) + "%" : "N/A"}
Potential Savings Found: ${analysis.totalPotentialSavings ? "$" + analysis.totalPotentialSavings.toFixed(2) : "None detected"}
Errors/Issues Found: ${analysis.errorsFound || 0}

Extracted Information:
${extractedFields.length > 0 ? extractedFields.join("\n") : "No metadata extracted"}

${analysis.warnings && analysis.warnings.length > 0 ? `Warnings: ${analysis.warnings.join(", ")}` : ""}

IMPORTANT INSTRUCTIONS FOR THIS BILL:
- Present the analysis results conversationally, NOT as a raw data dump
- Highlight any potential savings or errors found in a friendly, helpful way
- ${lowConfidenceFields.length > 0 ? `ASK THE USER TO VERIFY these low-confidence fields: ${lowConfidenceFields.join(", ")}` : "All fields have high confidence"}
- If errors were found, explain them clearly and suggest next steps
- Guide the user to confirm or correct the extracted information
- Once confirmed, let them know the bill has been saved to their account
- Legend: ✅ = high confidence (90%+), ⚠️ = medium (70-89%), ❓ = low (<70%)`;
    }

    const systemPrompt = `You are Wellbie, the AI assistant for Reclaim - an HSA/FSA expense tracking and tax optimization platform.

Your expertise includes:
- HSA/FSA eligibility rules and contribution limits (2025: $4,300 individual / $8,550 family HSA; FSA $3,300 with up to $660 carryover)
- 2025 regulatory updates: telehealth/remote care coverage no longer disqualifies HSA eligibility (P.L. 119-21); OTC oral contraceptives and male condoms now qualify as HSA-eligible preventive care (Notice 2024-75 / Notice 2024-71); continuous glucose monitors for diabetics are now classified as preventive care
- Tax-advantaged healthcare spending strategies
- Receipt documentation requirements for IRS audits
- When to reimburse vs. invest HSA funds for long-term growth
- Credit card rewards optimization for medical expenses (earn 2-3% back on healthcare)
- Medical bill error detection and dispute guidance
- How to use the Reclaim platform features

Personality: Supportive coach + analytical guide. Calm, helpful, slightly playful.

Key strategies you recommend:
1. **Pay out of pocket + reimburse later**: Let HSA investments grow tax-free, use rewards cards for expenses
2. **Document everything**: Multiple receipts, invoices, EOBs for IRS compliance
3. **Payment plans**: Track installment payments properly, reimburse when fully paid
4. **Timing matters**: Reimburse strategically based on investment goals vs cash flow needs
5. **Review bills for errors**: Up to 80% of medical bills contain errors - always verify before paying

Always provide actionable advice and guide users to relevant app features when appropriate.
Keep responses concise (2-3 paragraphs max) unless user asks for details.
Use emojis sparingly for visual interest: 💰📋💡🎯📊🔍

${context?.page ? `\n\nUser is currently on: ${context.page}` : ""}
${context?.expenseCount ? `\nUser has ${context.expenseCount} tracked expenses` : ""}${billAnalysisSection}`;

    console.log("Streaming chat request with context:", context);

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Wellbie is taking a quick break. Try again in a moment!",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error: "Service temporarily unavailable. Please try again later.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to reach AI service" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Wellbie chat error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
