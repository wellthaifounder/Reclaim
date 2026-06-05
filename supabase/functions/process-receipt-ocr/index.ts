import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

    // Reclaim: direct Google AI Studio (Gemini API). This endpoint is *not*
    // BAA-eligible. Phase 6 production cutover will swap this to Vertex AI
    // (GCP BAA-covered). The prompt and response parsing stay identical; only
    // the endpoint URL and auth header change at that point.
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    // Gemini's inline_data wants raw base64 + the mime type as separate
    // fields, not a data URL. The Zod regex above guarantees the prefix is
    // present and well-formed, so this split is safe.
    const [dataUrlHeader, rawBase64] = imageBase64.split(",", 2);
    const mimeMatch = dataUrlHeader.match(/^data:(image\/[a-z]+);base64$/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

    console.log("Processing receipt with OCR...");

    const PROMPT = `Extract Reclaim Substantiation-Record fields from this receipt and return ONLY valid JSON:
{
  "amount": <number or null>,
  "vendor": "<string or null>",
  "date": "<YYYY-MM-DD or null>",
  "category": "<one of: Medical, Dental, Vision, Pharmacy, Prescription, Therapy, Chiropractic, Food & Dining, Groceries, Transportation, Other or null>",
  "isHSAEligible": <boolean>,
  "confidence": <number 0-1>,
  "invoiceNumber": "<string or null>",
  "insurance": "<string or null>",
  "serviceDate": "<YYYY-MM-DD or null>",
  "billDate": "<YYYY-MM-DD or null>",
  "metadataConfidence": <number 0-1>,
  "warnings": [<string>]
}

Rules:
- Return ONLY the JSON object, no other text. Use null for any field you cannot extract.
- category: choose the best match from the list above
- isHSAEligible: true ONLY for medical, dental, vision, prescription, pharmacy, therapy, or chiropractic; false for food, groceries, gas, retail
- confidence (0-1): overall extraction confidence for the core fields (amount/vendor/date/category)
- invoiceNumber: account number, statement ID, or invoice/bill number printed on the document
- insurance: payer/insurance company name if visible (e.g. "Blue Cross", "Aetna")
- serviceDate: date the medical service was rendered. If a date range, use the latest date in the range
- billDate: date the bill or statement was issued (often labeled "Statement Date" or "Date of Bill")
- metadataConfidence (0-1): confidence in the structured-metadata fields (invoiceNumber/insurance/serviceDate/billDate)
- warnings: short human-readable strings flagging issues, e.g. "amount illegible", "no service date found", "low confidence on vendor". Empty array if none.
- If serviceDate is unclear but billDate is visible, prefer to leave serviceDate null and add a warning rather than guessing.`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mimeType, data: rawBase64 } },
              ],
            },
          ],
          // Gemini's native JSON mode — eliminates markdown-fence stripping.
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);

      if (response.status === 429) {
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

      // 400 INVALID_ARGUMENT, 403 PERMISSION_DENIED (bad/missing key), 5xx —
      // all collapse to the generic 500 client response. Server-side log
      // above captures the specific Gemini error code/message for debugging.
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Gemini response:", JSON.stringify(data).slice(0, 500));

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("No content in Gemini response");
    }

    // Parse the JSON from the response. responseMimeType=application/json
    // guarantees pure JSON, but a defensive try/catch stays as a guard
    // against future model regressions.
    let extractedData;
    try {
      extractedData = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON:", content);
      throw new Error("Failed to parse OCR results");
    }

    const warnings = Array.isArray(extractedData.warnings)
      ? extractedData.warnings.filter((w: unknown) => typeof w === "string")
      : [];

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          amount: extractedData.amount,
          vendor: extractedData.vendor,
          date: extractedData.date,
          category: extractedData.category,
          isHSAEligible: extractedData.isHSAEligible || false,
          confidence: extractedData.confidence || 0.5,
          // Reclaim metadata extraction (Phase 2)
          invoiceNumber: extractedData.invoiceNumber ?? null,
          insurance: extractedData.insurance ?? null,
          serviceDate: extractedData.serviceDate ?? null,
          billDate: extractedData.billDate ?? null,
          metadataConfidence:
            typeof extractedData.metadataConfidence === "number"
              ? extractedData.metadataConfidence
              : 0,
          warnings,
          rawResponse: content,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error in process-receipt-ocr:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Unable to process receipt",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
