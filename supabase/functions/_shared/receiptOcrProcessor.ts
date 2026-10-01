// Reclaim — shared receipt OCR processor (Vertex AI Gemini, BAA-covered).
//
// Extracts Substantiation-Record fields from a receipt image or a PDF. This
// logic was lifted out of the JWT-gated `process-receipt-ocr` HTTP function so
// it can be reused server-to-server by the inbound-email webhook (which has no
// end-user JWT) and by `scan-document`. All callers share one code path and
// one prompt.
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
  /** The FIRST date of care (SUBSTANTIATE_SPEC S10). */
  serviceDate: string | null;
  /** The last date of care, when the document shows a range. */
  serviceDateEnd: string | null;
  billDate: string | null;
  /** Who the care was for, "First Last". */
  patientName: string | null;
  /** One of DOCUMENT_TYPES, or null when the document does not say. */
  documentType: string | null;
  /** What was bought or done. Empty for a bare card slip (S28). */
  itemsBought: string[];
  metadataConfidence: number;
  warnings: string[];
  rawResponse: string;
}

/**
 * The document types the scan may assign. Must stay a subset of
 * `receipts_document_type_check` and of src/lib/documentTypes.ts.
 */
export const SCAN_DOCUMENT_TYPES = [
  "receipt",
  "payment_receipt",
  "itemized_statement",
  "invoice",
  "eob",
  "prescription_label",
  "letter_of_medical_necessity",
  "payment_plan_agreement",
  "other",
] as const;

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

/** Images, plus PDFs: Gemini reads a PDF inline, every page of it (S7). */
export const ACCEPTED_DOCUMENT_MIME =
  /^(image\/(png|jpeg|jpg|gif|webp)|application\/pdf)$/;

const PROMPT = `Extract Reclaim Substantiation-Record fields from this medical receipt, bill or other healthcare document and return ONLY valid JSON:
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
  "serviceDateEnd": "<YYYY-MM-DD or null>",
  "billDate": "<YYYY-MM-DD or null>",
  "patientName": "<string or null>",
  "documentType": "<one of: ${SCAN_DOCUMENT_TYPES.join(", ")}>",
  "itemsBought": [<string>],
  "metadataConfidence": <number 0-1>,
  "warnings": [<string>]
}

Rules:
- Return ONLY the JSON object, no other text. Use null for any field you cannot extract.
- amount: what the patient paid or owes. On an explanation of benefits, the patient responsibility, not the amount billed.
- vendor: the provider's or store's name as a person would say it (e.g. "Smile Dental Group"), not a card-terminal code.
- category: choose the best match from the list above
- isHSAEligible: true ONLY for medical, dental, vision, prescription, pharmacy, therapy, or chiropractic; false for food, groceries, gas, retail
- confidence (0-1): overall extraction confidence for the core fields (amount/vendor/date/category)
- invoiceNumber: account number, statement ID, or invoice/bill number printed on the document
- insurance: payer/insurance company name if visible (e.g. "Blue Cross", "Aetna")
- serviceDate: the date the care was given or the item was bought. If the document shows a range of dates (a hospital stay, a course of treatment, several visits), this is the EARLIEST date in the range.
- serviceDateEnd: the LATEST date of that range. null when the care happened on a single day.
- billDate: date the bill or statement was issued (often labeled "Statement Date" or "Date of Bill")
- patientName: the patient the care was for, written "First Last" even if the document prints "LAST, FIRST". null if no patient is named. Never the doctor's name, and never the cardholder on a card slip unless they are named as the patient.
- documentType: receipt = a store or pharmacy receipt listing what was bought; payment_receipt = a card slip or payment confirmation showing only that an amount was paid; itemized_statement = a provider's itemised statement of services; invoice = a bill asking for payment; eob = an insurer's explanation of benefits; prescription_label = a pharmacy label; letter_of_medical_necessity = a clinician's letter saying a treatment is medically necessary; payment_plan_agreement = an agreement to pay in instalments; other = anything else.
- itemsBought: what was bought or done, one short entry per line item, at most 10 (e.g. "Ibuprofen 200mg", "Dental cleaning"). An empty array if the document only shows that an amount was paid.
- metadataConfidence (0-1): confidence in the structured-metadata fields (invoiceNumber/insurance/serviceDate/billDate)
- warnings: short human-readable strings flagging issues, e.g. "amount illegible", "no service date found", "low confidence on vendor". Empty array if none.
- If serviceDate is unclear but billDate is visible, prefer to leave serviceDate null and add a warning rather than guessing.`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Turn the model's JSON into an OcrResult, trusting nothing about its shape.
 * Exported for tests.
 */
export function normalizeOcrResult(
  extracted: Record<string, unknown>,
  rawResponse: string,
): OcrResult {
  const warnings = Array.isArray(extracted.warnings)
    ? (extracted.warnings as unknown[]).filter(
        (w): w is string => typeof w === "string",
      )
    : [];

  const itemsBought = Array.isArray(extracted.itemsBought)
    ? (extracted.itemsBought as unknown[])
        .filter((i): i is string => typeof i === "string")
        .map((i) => i.trim())
        .filter((i) => i !== "")
        .slice(0, 10)
    : [];

  const documentType =
    typeof extracted.documentType === "string" &&
    (SCAN_DOCUMENT_TYPES as readonly string[]).includes(extracted.documentType)
      ? extracted.documentType
      : null;

  const serviceDate = isoDateOrNull(extracted.serviceDate);
  let serviceDateEnd = isoDateOrNull(extracted.serviceDateEnd);
  // A "range" that ends where it starts, or before, is a single day.
  if (!serviceDate || (serviceDateEnd && serviceDateEnd <= serviceDate)) {
    serviceDateEnd = null;
  }

  const amount =
    typeof extracted.amount === "number"
      ? extracted.amount
      : typeof extracted.amount === "string"
        ? parseFloat(extracted.amount.replace(/[$,\s]/g, ""))
        : NaN;

  return {
    amount: Number.isFinite(amount) ? amount : null,
    vendor: textOrNull(extracted.vendor),
    date: isoDateOrNull(extracted.date),
    category: textOrNull(extracted.category),
    isHSAEligible: extracted.isHSAEligible === true,
    confidence:
      typeof extracted.confidence === "number" ? extracted.confidence : 0.5,
    invoiceNumber: textOrNull(extracted.invoiceNumber),
    insurance: textOrNull(extracted.insurance),
    serviceDate,
    serviceDateEnd,
    billDate: isoDateOrNull(extracted.billDate),
    patientName: textOrNull(extracted.patientName),
    documentType,
    itemsBought,
    metadataConfidence:
      typeof extracted.metadataConfidence === "number"
        ? extracted.metadataConfidence
        : 0,
    warnings,
    rawResponse,
  };
}

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
 * payload (no `data:` prefix); `mimeType` is e.g. "image/png" or
 * "application/pdf".
 *
 * Throws OcrError on failure (status 429 for rate-limit, 502 for upstream/parse
 * errors, 400 for bad input).
 */
export async function processReceiptOcr(
  rawBase64: string,
  mimeType: string,
): Promise<OcrResult> {
  if (!ACCEPTED_DOCUMENT_MIME.test(mimeType)) {
    throw new OcrError(`Unsupported document type: ${mimeType}`, 400);
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
    // 5xx — all collapse to a generic upstream failure for the caller. 503,
    // not 502: the scan is not at fault for the document, so scan-document
    // must not mark it "Couldn't read this" (502 below is a document the model
    // could not make sense of).
    throw new OcrError(`Vertex AI error: ${response.status}`, 503);
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
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    throw new OcrError("OCR result was not an object", 502);
  }

  return normalizeOcrResult(extracted, content);
}
