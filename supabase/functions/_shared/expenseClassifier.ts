// Reclaim — Phase 3 expense classifier (Vertex AI Gemini + IRS Pub 502 catalog).
//
// Given an invoice (and any attached OCR metadata), picks the most likely
// matching IRS Pub 502 rule, scores confidence, and writes a structured
// explanation that the user sees verbatim in the review queue.
//
// The output never flips lifecycle_status to ELIGIBLE — that transition
// requires the user's explicit confirmation (the audit-trail moat).
// Classification moves an expense from CAPTURED → PENDING_REVIEW.
//
// Caller is responsible for invocation context: this module is provider-
// neutral on auth (works with anon-key + user JWT for the classify-expense
// edge fn, or with the service role for any background path). It does NOT
// enforce RLS.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getVertexAccessToken,
  vertexGenerateContentUrl,
} from "./vertexAuth.ts";

export interface Pub502Rule {
  id: string;
  name: string;
  category: string;
  eligibility_status: "eligible" | "conditional" | "ineligible";
  conditions: string | null;
  section_ref: string | null;
  examples: string[] | null;
  notes: string | null;
}

export interface ExpenseInput {
  invoiceId: string;
  vendor: string;
  amount: number;
  date: string;
  category: string | null;
  notes: string | null;
  patientName: string | null;
  // From receipt_ocr_data when present — gives Gemini better signal than
  // user-entered fields alone.
  ocr?: {
    extractedVendor?: string | null;
    extractedDate?: string | null;
    extractedServiceDate?: string | null;
    extractedInvoiceNumber?: string | null;
    extractedInsurance?: string | null;
    metadataConfidence?: number | null;
    extractionWarnings?: string[] | null;
  } | null;
}

export interface ClassificationOutput {
  ruleId: string;
  confidence: number;
  reasoning: string;
  warnings: string[];
  rawResponse?: string;
}

let rulesCacheLoaded = false;
let rulesCache: Pub502Rule[] = [];

async function loadRules(supabase: SupabaseClient): Promise<Pub502Rule[]> {
  if (rulesCacheLoaded) return rulesCache;
  const { data, error } = await supabase
    .from("pub_502_rules")
    .select(
      "id, name, category, eligibility_status, conditions, section_ref, examples, notes",
    );
  if (error) {
    console.warn("[expenseClassifier] rules cache load failed:", error.message);
    rulesCacheLoaded = true;
    return [];
  }
  rulesCache = (data ?? []) as Pub502Rule[];
  rulesCacheLoaded = true;
  return rulesCache;
}

/** Reset cache. Tests only. */
export function _resetRulesCacheForTests(): void {
  rulesCacheLoaded = false;
  rulesCache = [];
}

function buildPrompt(input: ExpenseInput, rules: Pub502Rule[]): string {
  // Compact rule catalog — id + name + status + 1-line conditions/examples.
  // Keeps prompt size bounded as the catalog grows.
  const catalog = rules
    .map((r) => {
      const ex =
        r.examples && r.examples.length > 0
          ? ` ex: ${r.examples.slice(0, 3).join("; ")}`
          : "";
      const cond = r.conditions ? ` — ${r.conditions}` : "";
      return `- ${r.id} | ${r.name} | ${r.eligibility_status}${cond}${ex}`;
    })
    .join("\n");

  return `You are Reclaim's eligibility classifier. Match the expense below to the most likely IRS Pub 502 rule from the catalog. Return ONLY valid JSON with this exact shape:
{
  "ruleId": "<id from catalog OR 'unclassified-other' if no rule fits>",
  "confidence": <number 0-1>,
  "reasoning": "<one sentence in plain English explaining the match>",
  "warnings": [<string>]
}

Rules of engagement:
- Confidence reflects how strongly you believe this expense matches the chosen rule. ≥0.85 means very confident; 0.6–0.85 means probable but reviewable; <0.6 means low confidence (caller will route to NEEDS_RECEIPT if so).
- Reasoning is shown verbatim to the user during review — keep it specific to THIS expense (mention vendor or OCR signal where helpful).
- Warnings flag things the user should know before confirming: missing receipt, ambiguous vendor, date before HSA opening (if hsaOpenedDate provided), service date materially different from bill date, etc. Empty array if nothing of concern.
- If the expense is clearly NOT medical (groceries, gas, retail), pick 'unclassified-other' with eligibility-relevant warnings.
- Prefer specific rules over generic catch-alls when there's a reasonable signal.

Expense:
- Vendor: ${input.vendor}
- Amount: $${input.amount.toFixed(2)}
- Date: ${input.date}
- User-picked category: ${input.category ?? "(none)"}
- Patient: ${input.patientName ?? "(unspecified)"}
- Notes: ${input.notes ?? "(none)"}
${
  input.ocr
    ? `
OCR signal:
- Extracted vendor: ${input.ocr.extractedVendor ?? "(none)"}
- Bill date: ${input.ocr.extractedDate ?? "(none)"}
- Service date: ${input.ocr.extractedServiceDate ?? "(none)"}
- Invoice number: ${input.ocr.extractedInvoiceNumber ?? "(none)"}
- Insurance: ${input.ocr.extractedInsurance ?? "(none)"}
- Metadata confidence: ${input.ocr.metadataConfidence ?? "(unknown)"}
- Extraction warnings: ${(input.ocr.extractionWarnings ?? []).join(", ") || "(none)"}
`
    : ""
}
Pub 502 rule catalog:
${catalog}
`;
}

/**
 * Classify an expense and persist results back to `invoices`.
 *
 * Returns the classification output (also persisted as a side-effect).
 *
 * Lifecycle:
 *   - Sets classified_at = now()
 *   - Stamps eligibility_basis_rule_id, classification_confidence,
 *     classification_reasoning, classification_warnings on the invoice
 *   - Transitions lifecycle_status: CAPTURED → PENDING_REVIEW; or
 *     CAPTURED → NEEDS_RECEIPT if confidence < 0.6 and no receipts attached.
 *   - Never touches confirmed_at (only user action does that).
 */
export async function classifyAndPersist(
  supabase: SupabaseClient,
  input: ExpenseInput,
): Promise<ClassificationOutput> {
  const rules = await loadRules(supabase);
  if (rules.length === 0) {
    throw new Error("Pub 502 rules catalog is empty");
  }

  // Vertex AI (BAA-covered). Medical expense context is PHI, so this must not
  // use the non-BAA AI Studio endpoint. Auth is a service-account OAuth token
  // (see _shared/vertexAuth.ts).
  const accessToken = await getVertexAccessToken();

  const prompt = buildPrompt(input, rules);
  const response = await fetch(vertexGenerateContentUrl("gemini-2.5-flash"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      "[expenseClassifier] Vertex AI error:",
      response.status,
      errText,
    );
    throw new Error(`Vertex AI error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Empty Vertex AI response");

  let parsed: {
    ruleId?: string;
    confidence?: number;
    reasoning?: string;
    warnings?: string[];
  };
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.error(
      "[expenseClassifier] JSON parse failed:",
      content.slice(0, 500),
    );
    throw new Error("Could not parse classifier output");
  }

  // Defensively normalize.
  const knownIds = new Set(rules.map((r) => r.id));
  const ruleId =
    parsed.ruleId && knownIds.has(parsed.ruleId)
      ? parsed.ruleId
      : "unclassified-other";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning : "";
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === "string")
    : [];

  // Receipt count for the lifecycle decision.
  const { count: receiptCount } = await supabase
    .from("receipts")
    .select("*", { head: true, count: "exact" })
    .eq("invoice_id", input.invoiceId);

  // Workstream B: `lifecycle_status` is now derived from the three facets by
  // trg_invoices_sync_lifecycle, so writing it directly would be overwritten.
  // Set the facet instead. Classification produces a Pub 502 basis and a
  // confidence — it does NOT confirm eligibility, because explicit user
  // confirmation is the audit-trail event that earns 'eligible'. So the
  // eligibility facet is deliberately left untouched here; only documentation
  // state is recorded, which is what drives needs_receipt vs pending_review.
  const documentationState = (receiptCount ?? 0) > 0 ? "complete" : "none";

  const { error: updateErr } = await supabase
    .from("invoices")
    .update({
      eligibility_basis_rule_id: ruleId,
      classification_confidence: Number(confidence.toFixed(2)),
      classification_reasoning: reasoning,
      classification_warnings: warnings,
      classified_at: new Date().toISOString(),
      documentation_state: documentationState,
    })
    .eq("id", input.invoiceId);
  if (updateErr) {
    console.warn(
      "[expenseClassifier] invoice update failed:",
      updateErr.message,
    );
  }

  return { ruleId, confidence, reasoning, warnings, rawResponse: content };
}
