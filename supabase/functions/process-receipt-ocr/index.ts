import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  OcrError,
  parseImageDataUrl,
  processReceiptOcr,
} from "../_shared/receiptOcrProcessor.ts";

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
      : (allowedOrigins[1] ?? "https://www.wellth-ai.app");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Input validation schema - limit image size to 10MB base64
const ocrSchema = z.object({
  imageBase64: z
    .string()
    .min(100, "Image data too small")
    .max(13500000, "Image size exceeds 10MB limit")
    .regex(
      /^data:image\/(png|jpeg|jpg|gif|webp);base64,/,
      "Invalid image format",
    ),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authentication
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
    const body = await req.json();

    // Validate input
    const validation = ocrSchema.safeParse(body);
    if (!validation.success) {
      console.error("Validation error:", validation.error);
      return new Response(
        JSON.stringify({ error: "Invalid image data or size exceeds limit" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { imageBase64 } = validation.data;

    console.log("Processing receipt with OCR...");

    // Gemini's inline_data wants raw base64 + the mime type as separate
    // fields, not a data URL. The Zod regex above guarantees the prefix is
    // present and well-formed. OCR logic lives in the shared module so the
    // inbound-email webhook (no user JWT) shares one code path.
    const { rawBase64, mimeType } = parseImageDataUrl(imageBase64);
    const result = await processReceiptOcr(rawBase64, mimeType);

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    // Preserve the rate-limit signal for the client; everything else is generic.
    if (error instanceof OcrError && error.status === 429) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Please try again later.",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    console.error(
      "Error in process-receipt-ocr:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({ success: false, error: "Unable to process receipt" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
