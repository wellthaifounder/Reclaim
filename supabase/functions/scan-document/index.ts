// Reclaim — scan-document edge function (SUBSTANTIATE_SPEC S7-S12, S24).
//
// Called by the browser for every document that lands on an expense: an
// upload, a photo, a pick from the library, and Scan again. In one request:
//
//   1. Read the stored file -- image or PDF -- and keep what it says with the
//      document (receipt_ocr_data), unless it was already read and this is not
//      a rescan: a reused document fills the form without a second scan (S11).
//   2. Fill the expense's gaps from it (apply_document_scan): blanks and
//      defaults only, never what a person entered (S9).
//   3. Run the IRS-category check against everything now attached (S24), so
//      the "Work out if this qualifies" button no longer has to exist.
//
// A document the scan cannot read is still a success: it stays attached and is
// marked "Couldn't read this" (S8). Only failures that are not the document's
// fault -- the AI service down or rate-limited -- come back as errors, so the
// person is told to try again rather than that their document is unreadable.
//
// Auth model: user JWT required (verify_jwt = true in config.toml). Every read
// and write goes through a client carrying that JWT, so storage policies and
// row-level security scope the work to the caller's own documents.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.22.4";
import { OcrError } from "../_shared/receiptOcrProcessor.ts";
import {
  loadAttachedScans,
  scanAndStore,
  type ScanStatus,
} from "../_shared/documentScan.ts";
import { classifyAndPersist } from "../_shared/expenseClassifier.ts";

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
  receipt_id: z.string().uuid(),
  /** The expense to fill and re-check. Omitted, the document is only read. */
  invoice_id: z.string().uuid().optional(),
  /** Scan again: read the file even though a reading is already kept. */
  rescan: z.boolean().optional(),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // 1. Authenticate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  try {
    // 2. Validate input
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid request." }, 400);
    const { receipt_id, invoice_id, rescan = false } = parsed.data;

    // 3. The document, and that it backs this expense. Row-level security
    // already limits both reads to the caller's own rows; user_id is checked
    // as well so the ownership rule is visible here.
    const { data: doc } = await supabase
      .from("receipts")
      .select(
        "id, user_id, file_path, file_type, document_type, document_type_source",
      )
      .eq("id", receipt_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!doc) return json({ error: "Document not found." }, 404);

    if (invoice_id) {
      const { data: link } = await supabase
        .from("receipt_invoices")
        .select("receipt_id")
        .eq("receipt_id", receipt_id)
        .eq("invoice_id", invoice_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!link) {
        return json({ error: "That document isn't on this expense." }, 404);
      }
    }

    // 4. Read it, unless it already has been (S11).
    let status: ScanStatus;
    const { data: kept } = await supabase
      .from("receipt_ocr_data")
      .select("scan_status")
      .eq("receipt_id", receipt_id)
      .maybeSingle();
    if (kept && !rescan) {
      status = kept.scan_status as ScanStatus;
    } else {
      status = (await scanAndStore(supabase, doc)).status;
    }

    // 5. Fill the expense's gaps, then re-run the category check.
    let filled: string[] = [];
    let classified = false;
    if (invoice_id && status === "read") {
      const { data: fill, error: fillErr } = await supabase.rpc(
        "apply_document_scan",
        { p_invoice_id: invoice_id, p_receipt_id: receipt_id },
      );
      if (fillErr) throw new Error(`apply_document_scan: ${fillErr.message}`);
      filled = (fill as string[] | null) ?? [];

      // The category check is the second AI call. Its failure leaves the
      // scan's work standing, so it is reported, not thrown.
      try {
        const { data: inv } = await supabase
          .from("invoices")
          .select("id, vendor, amount, date, category, notes, patient_name")
          .eq("id", invoice_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (inv) {
          await classifyAndPersist(supabase, {
            invoiceId: inv.id,
            vendor: inv.vendor,
            amount: Number(inv.amount),
            date: inv.date,
            category: inv.category,
            notes: inv.notes,
            patientName: inv.patient_name,
            documents: await loadAttachedScans(supabase, inv.id),
          });
          classified = true;
        }
      } catch (e) {
        console.error(
          "[scan-document] category check failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return json({ success: true, status, filled, classified });
  } catch (error) {
    if (error instanceof OcrError && error.status === 429) {
      return json(
        { error: "Too many scans at once. Please try again shortly." },
        429,
      );
    }
    // Generic error — never leak internal details to the client.
    console.error(
      "[scan-document] Error:",
      error instanceof Error ? error.message : error,
    );
    return json(
      { error: "An unexpected error occurred. Please try again." },
      500,
    );
  }
});
