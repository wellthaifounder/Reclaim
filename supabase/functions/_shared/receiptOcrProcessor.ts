// Reclaim — shared receipt OCR processor (Vertex AI Gemini, BAA-covered).
//
// Extracts Substantiation-Record fields from a receipt image. This logic was
// lifted out of the JWT-gated `process-receipt-ocr` HTTP function so it can be
// reused server-to-server by the inbound-email webhook (which has no end-user
// JWT). Both callers share one code path and one prompt.
//
// Auth is a service-account OAuth token (see _shared/vertexAuth.ts), required
// because receipt images are PHI and the direct AI Studio endpoint is not
// BAA-eligible. See CLAUDE.md "AI Integration".

import {
  getVertexAccessToken,
  vertexGenerateContentUrl,
} from "./vertexAuth.ts";

export interface OcrResult {
  amount: number | null;
  vendor: string | null;
  date: string | null;
  category: string | null;
  isHSAEligible: boolean;
  confidence: number;
  invoiceNumber: string | null;
  insurance: string | null;
  serviceDate: string | null;
  billDate: string | null;
  metadataConfidence: number;
  warnings: string[];
  rawResponse: string;
}

// Carries an HTTP-ish status so the JWT HTTP handler can preserve its 429
// behavior while background callers (webhook) can just catch and degrade.
export class OcrError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OcrError";
    this.status = status;
  }
}

// Mime types Gemini inline_data accepts for receipt images.
export const ACCEPTED_IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp)$/;

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

/**
 * Split a `data:image/...;base64,xxxx` URL into raw base64 + mime type.
 * Throws OcrError(400) if the prefix is missing/malformed.
 */
export function parseImageDataUrl(dataUrl: string): {
  rawBase64: string;
  mimeType: string;
} {
  const [header, rawBase64] = dataUrl.split(",", 2);
  const mimeMatch = header?.match(/^data:(image\/[a-z]+);base64$/);
  if (!mimeMatch || !rawBase64) {
    throw new OcrError("Invalid image data URL", 400);
  }
  return { rawBase64, mimeType: mimeMatch[1] };
}

/**
 * Run receipt OCR against Vertex AI Gemini. `rawBase64` is the bare base64
 * payload (no `data:` prefix); `mimeType` is e.g. "image/png".
 *
 * Throws OcrError on failure (status 429 for rate-limit, 502 for upstream/parse
 * errors, 400 for bad input).
 */
export async function processReceiptOcr(
  rawBase64: string,
  mimeType: string,
): Promise<OcrResult> {
  if (!ACCEPTED_IMAGE_MIME.test(mimeType)) {
    throw new OcrError(`Unsupported image type: ${mimeType}`, 400);
  }

  const accessToken = await getVertexAccessToken();

  const response = await fetch(vertexGenerateContentUrl("gemini-2.5-flash"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          // `role` is required on Vertex AI and rejected as
          // "Please use a valid role: user, model." when missing. The direct
          // AI Studio endpoint defaults it, which is why the omission survived
          // the migration to Vertex unnoticed -- the code was only ever
          // exercised against the endpoint that forgave it.
          role: "user",
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: rawBase64 } },
          ],
        },
      ],
      // Gemini's native JSON mode — eliminates markdown-fence stripping.
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[receiptOcr] Vertex AI error:", response.status, errorText);
    if (response.status === 429) {
      throw new OcrError("Rate limit exceeded. Please try again later.", 429);
    }
    // 400 INVALID_ARGUMENT, 401/403 (bad/expired token or missing IAM role),
    // 5xx — all collapse to a generic upstream failure for the caller.
    throw new OcrError(`Vertex AI error: ${response.status}`, 502);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new OcrError("No content in Vertex AI response", 502);
  }

  // responseMimeType=application/json guarantees pure JSON, but a defensive
  // try/catch stays as a guard against future model regressions.
  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(content);
  } catch {
    console.error("[receiptOcr] Failed to parse Gemini response as JSON");
    throw new OcrError("Failed to parse OCR results", 502);
  }

  const warnings = Array.isArray(extracted.warnings)
    ? (extracted.warnings as unknown[]).filter(
        (w): w is string => typeof w === "string",
      )
    : [];

  return {
    amount: (extracted.amount as number) ?? null,
    vendor: (extracted.vendor as string) ?? null,
    date: (extracted.date as string) ?? null,
    category: (extracted.category as string) ?? null,
    isHSAEligible: (extracted.isHSAEligible as boolean) || false,
    confidence: (extracted.confidence as number) || 0.5,
    invoiceNumber: (extracted.invoiceNumber as string) ?? null,
    insurance: (extracted.insurance as string) ?? null,
    serviceDate: (extracted.serviceDate as string) ?? null,
    billDate: (extracted.billDate as string) ?? null,
    metadataConfidence:
      typeof extracted.metadataConfidence === "number"
        ? extracted.metadataConfidence
        : 0,
    warnings,
    rawResponse: content,
  };
}
