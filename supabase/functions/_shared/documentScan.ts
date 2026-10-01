// Reclaim — scan one stored document and keep what it reads
// (SUBSTANTIATE_SPEC S7, S8, S10, S11).
//
// The dialog used to read the first image of an upload from the browser, show
// the result, and throw it away. This reads the document from storage instead
// -- so a PDF, a document chosen from the library, and Scan again all take the
// same path -- and keeps the result with the DOCUMENT, one row per document,
// so a document reused on another expense fills it without a second scan.
//
// The caller's client decides what may be read and written: scan-document
// passes one built from the user's JWT, so storage and row-level security
// scope everything to that user.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import {
  ACCEPTED_DOCUMENT_MIME,
  OcrError,
  type OcrResult,
  processReceiptOcr,
} from "./receiptOcrProcessor.ts";

/** Inline data on Vertex is capped near 20MB; base64 adds a third. */
export const MAX_SCAN_BYTES = 14 * 1024 * 1024;

export type ScanStatus = "read" | "unreadable";

export interface StoredDocument {
  id: string;
  file_path: string;
  file_type: string;
  document_type: string | null;
  document_type_source: string | null;
}

/**
 * The mime type to send. The stored type wins; a PDF saved without one is
 * still recognised by its name.
 */
export function scanMimeType(
  doc: Pick<StoredDocument, "file_type" | "file_path">,
) {
  const stored = (doc.file_type ?? "").toLowerCase();
  if (stored === "image/jpg") return "image/jpeg";
  if (stored) return stored;
  return doc.file_path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "";
}

/**
 * True when the model answered but found nothing a person would call a
 * reading: no provider, no amount, no date, nothing bought. A photo of the
 * wrong thing lands here, and is marked "Couldn't read this" (S8) rather than
 * kept as a scan that fills nothing.
 */
export function readNothing(r: OcrResult): boolean {
  return (
    !r.vendor &&
    r.amount == null &&
    !r.date &&
    !r.serviceDate &&
    !r.patientName &&
    r.itemsBought.length === 0
  );
}

/**
 * Read the document and store the result, replacing any earlier one.
 *
 * Returns the status. Throws (and stores nothing) when the failure is not the
 * document's fault -- storage unreachable, the AI service down or rate-limited
 * -- so the person is told to try again instead of being told their document
 * is unreadable.
 */
export async function scanAndStore(
  supabase: SupabaseClient,
  doc: StoredDocument,
): Promise<{ status: ScanStatus; result: OcrResult | null }> {
  const mime = scanMimeType(doc);

  let result: OcrResult | null = null;
  if (ACCEPTED_DOCUMENT_MIME.test(mime)) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from("receipts")
      .download(doc.file_path);
    if (dlErr || !blob) {
      throw new Error(`storage download failed: ${dlErr?.message ?? "empty"}`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > 0 && bytes.byteLength <= MAX_SCAN_BYTES) {
      try {
        result = await processReceiptOcr(encodeBase64(bytes), mime);
      } catch (e) {
        // 429 and 503 are the service, not the document.
        if (e instanceof OcrError && (e.status === 429 || e.status === 503)) {
          throw e;
        }
        if (!(e instanceof OcrError)) throw e;
        result = null;
      }
    }
  }

  const status: ScanStatus =
    result && !readNothing(result) ? "read" : "unreadable";
  const read = status === "read" ? result : null;

  // A rescan replaces every field, so nothing from an earlier reading lingers.
  const { error: saveErr } = await supabase.from("receipt_ocr_data").upsert(
    {
      receipt_id: doc.id,
      scan_status: status,
      extracted_amount: read?.amount ?? null,
      extracted_vendor: read?.vendor ?? null,
      extracted_date: read?.date ?? null,
      extracted_category: read?.category ?? null,
      confidence_score: read?.confidence ?? null,
      extracted_invoice_number: read?.invoiceNumber ?? null,
      extracted_insurance: read?.insurance ?? null,
      extracted_service_date: read?.serviceDate ?? null,
      extracted_service_date_end: read?.serviceDateEnd ?? null,
      extracted_bill_date: read?.billDate ?? null,
      extracted_patient: read?.patientName ?? null,
      extracted_document_type: read?.documentType ?? null,
      extracted_items: read?.itemsBought ?? [],
      metadata_confidence: read
        ? Math.max(0, Math.min(1, read.metadataConfidence))
        : null,
      extraction_warnings: read?.warnings ?? [],
      raw_response: read?.rawResponse ?? null,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "receipt_id" },
  );
  if (saveErr) throw new Error(`saving the scan failed: ${saveErr.message}`);

  // What the document is (S10) -- unless a person said what it is.
  if (
    read?.documentType &&
    doc.document_type_source !== "person" &&
    read.documentType !== doc.document_type
  ) {
    const { error: typeErr } = await supabase
      .from("receipts")
      .update({
        document_type: read.documentType,
        document_type_source: "scan",
      })
      .eq("id", doc.id);
    if (typeErr) {
      console.warn(
        "[documentScan] document type update failed:",
        typeErr.message,
      );
    }
  }

  return { status, result: read };
}

/** What the classifier is told about each document attached to an expense. */
export interface AttachedScan {
  documentType: string | null;
  vendor: string | null;
  amount: number | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  patient: string | null;
  items: string[];
  invoiceNumber: string | null;
  insurance: string | null;
  metadataConfidence: number | null;
  warnings: string[];
}

/** Every readable scan of every document attached to the expense. */
export async function loadAttachedScans(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<AttachedScan[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, document_type, receipt_invoices!inner(invoice_id), receipt_ocr_data(scan_status, extracted_vendor, extracted_amount, extracted_service_date, extracted_service_date_end, extracted_patient, extracted_items, extracted_invoice_number, extracted_insurance, metadata_confidence, extraction_warnings)",
    )
    .eq("receipt_invoices.invoice_id", invoiceId);
  if (error) throw new Error(`loading attached scans failed: ${error.message}`);

  const scans: AttachedScan[] = [];
  for (const row of data ?? []) {
    const joined = row.receipt_ocr_data as unknown;
    const ocr = (Array.isArray(joined) ? joined[0] : joined) as
      Record<string, unknown> | null | undefined;
    if (!ocr || ocr.scan_status !== "read") continue;
    const strings = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((s): s is string => typeof s === "string")
        : [];
    scans.push({
      documentType: (row.document_type as string | null) ?? null,
      vendor: (ocr.extracted_vendor as string | null) ?? null,
      amount:
        ocr.extracted_amount == null ? null : Number(ocr.extracted_amount),
      serviceDate: (ocr.extracted_service_date as string | null) ?? null,
      serviceDateEnd: (ocr.extracted_service_date_end as string | null) ?? null,
      patient: (ocr.extracted_patient as string | null) ?? null,
      items: strings(ocr.extracted_items),
      invoiceNumber: (ocr.extracted_invoice_number as string | null) ?? null,
      insurance: (ocr.extracted_insurance as string | null) ?? null,
      metadataConfidence:
        ocr.metadata_confidence == null
          ? null
          : Number(ocr.metadata_confidence),
      warnings: strings(ocr.extraction_warnings),
    });
  }
  return scans;
}
