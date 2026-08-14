// Reclaim — Inbound email receipt-capture webhook (Resend "email.received").
//
// Users forward/email a receipt to their personal address
// <token>@<INBOUND_EMAIL_DOMAIN>. Resend receives it, parses metadata, and POSTs
// an `email.received` event here. We resolve the user from the token in the
// recipient address, pull each attachment, and feed it into the SAME
// capture -> OCR -> classify pipeline the upload wizard uses. Emailed receipts
// then appear in the existing dashboard "Pending Review" bucket — no new
// downstream workflow.
//
// Security model (mirrors plaid-webhook):
//   - Server-to-server endpoint, no end-user JWT. config.toml sets
//     verify_jwt = false. Authenticity comes from Svix signature verification
//     (Resend signs webhooks with Svix). Identity comes ONLY from the secret
//     token in the recipient address — the From header is spoofable on
//     forwarded mail and is never trusted.
//   - Uses SERVICE_ROLE_KEY; every write is scoped to the resolved user_id.
//   - Replies 200 after signature verification even on per-item errors so the
//     provider does not retry-storm on a logic bug. Verification failure -> 401.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ACCEPTED_IMAGE_MIME,
  OcrError,
  processReceiptOcr,
} from "../_shared/receiptOcrProcessor.ts";
import { classifyAndPersist } from "../_shared/expenseClassifier.ts";

const INBOUND_DOMAIN =
  Deno.env.get("INBOUND_EMAIL_DOMAIN") || "inbound.wellth-ai.app";

// Raw-bytes cap per attachment (10MB) — same ceiling as the wizard/OCR path.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Defensive cap on attachments processed per email.
const MAX_ATTACHMENTS_PER_EMAIL = 10;

interface ResendAttachmentMeta {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  content_disposition?: string;
  content_id?: string;
  download_url: string;
}

interface EmailReceivedData {
  email_id: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  message_id?: string;
  subject?: string;
  created_at?: string;
}

// Base64-encode bytes in chunks. A naive btoa(String.fromCharCode(...bytes))
// overflows the call stack for multi-MB images (spread arg limit).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Svix signature verification (manual; no SDK version dependency) ──────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvixSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  // Replay guard: reject timestamps more than 5 minutes from now.
  const now = Math.floor(Date.now() / 1000);
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) return false;

  const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    // Build via `new Uint8Array(len)` (fresh ArrayBuffer backing) rather than
    // Uint8Array.from(...), which infers Uint8Array<ArrayBufferLike> and is
    // rejected by importKey's BufferSource overload. Mirrors vertexAuth.ts.
    const binary = atob(secretKey);
    keyBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedContent = `${id}.${ts}.${rawBody}`;
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Header is a space-delimited list of "<version>,<signature>" pairs.
  const provided = sigHeader.split(" ").map((part) => {
    const comma = part.indexOf(",");
    return comma === -1 ? part : part.slice(comma + 1);
  });
  return provided.some((sig) => timingSafeEqual(sig, expected));
}

// Pull the inbound token out of whichever recipient address is on our domain.
function extractToken(data: EmailReceivedData): string | null {
  const candidates = [
    ...(data.to ?? []),
    ...(data.cc ?? []),
    ...(data.bcc ?? []),
  ];
  for (const raw of candidates) {
    // Addresses may arrive as "Name <local@domain>" or bare "local@domain".
    const match = raw.match(/<?([^<>\s@]+)@([^<>\s]+?)>?$/);
    if (!match) continue;
    const [, local, domain] = match;
    if (domain.toLowerCase() === INBOUND_DOMAIN.toLowerCase()) {
      return local.toLowerCase();
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();

  // ── 1. Verify the Resend (Svix) signature ───────────────────────────────
  const webhookSecret = Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !resendApiKey || !supabaseUrl || !serviceKey) {
    console.error("[inbound-email] Missing required env (secret/key/supabase)");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const verified = await verifySvixSignature(
    webhookSecret,
    req.headers,
    rawBody,
  );
  if (!verified) {
    console.warn("[inbound-email] Signature verification failed");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 2. Parse + dispatch ──────────────────────────────────────────────────
  let event: { type?: string; data?: EmailReceivedData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // First-run diagnostics: log the shape (keys only — never the addresses,
  // subject, or body, which can be PHI) so the first real forwarded email is
  // easy to verify against Resend's actual payload. Safe to keep long-term.
  console.log(
    "[inbound-email] event:",
    event.type,
    "dataKeys:",
    event.data ? Object.keys(event.data).join(",") : "(none)",
  );

  // Only the inbound receive event triggers ingestion. Ack everything else.
  if (event.type !== "email.received" || !event.data?.email_id) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const data = event.data;

    // ── 3. Resolve the user from the address token (never the From) ────────
    const token = extractToken(data);
    if (!token) {
      console.warn("[inbound-email] No on-domain recipient token found");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email_forward_enabled")
      .eq("email_forward_token", token)
      .maybeSingle();
    if (!profile || profile.email_forward_enabled === false) {
      // Unknown or disabled token: ignore silently (ack so no retries).
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    const userId = profile.id as string;

    // ── 4. List attachments (content arrives via signed download_url) ──────
    const attachRes = await fetch(
      `https://api.resend.com/emails/receiving/${data.email_id}/attachments`,
      { headers: { Authorization: `Bearer ${resendApiKey}` } },
    );
    if (!attachRes.ok) {
      console.error(
        "[inbound-email] attachments list failed:",
        attachRes.status,
      );
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    const attachBody = await attachRes.json();
    const attachments: ResendAttachmentMeta[] = (attachBody?.data ?? []).slice(
      0,
      MAX_ATTACHMENTS_PER_EMAIL,
    );

    // Diagnostics: count + content types (not PHI) help confirm the
    // attachments API shape matched on the first live email.
    console.log(
      "[inbound-email] attachments:",
      attachments.length,
      attachments.map((a) => a.content_type).join(",") || "(none)",
    );

    const receivedAt = data.created_at ?? new Date().toISOString();
    let captured = 0;

    for (const att of attachments) {
      const isImage = ACCEPTED_IMAGE_MIME.test(att.content_type);
      const isPdf = att.content_type === "application/pdf";
      if (!isImage && !isPdf) continue; // ignore signatures, logos, etc.
      if (att.size > MAX_ATTACHMENT_BYTES) {
        console.warn("[inbound-email] attachment too large, skipping");
        continue;
      }

      // Composite dedupe key: message + attachment, so a multi-attachment
      // email yields multiple invoices but a redelivered webhook does not.
      const dedupeKey = `${data.message_id ?? data.email_id}#${att.id}`;

      // Download the raw bytes from the signed URL.
      const fileRes = await fetch(att.download_url);
      if (!fileRes.ok) {
        console.warn("[inbound-email] attachment download failed");
        continue;
      }
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;

      // Run OCR only on Gemini-supported image types. PDFs/HEIC are stored as
      // receipts and left in CAPTURED for the user to fill in during review
      // (same as a PDF upload in the wizard).
      let ocr = null;
      if (isImage) {
        try {
          const base64 = bytesToBase64(bytes);
          ocr = await processReceiptOcr(base64, att.content_type);
        } catch (e) {
          if (e instanceof OcrError) {
            console.warn("[inbound-email] OCR failed, capturing without it");
          } else {
            throw e;
          }
        }
      }

      const vendor = ocr?.vendor || att.filename.replace(/\.[^.]+$/, "");
      const amount = ocr?.amount ?? 0;
      const date = ocr?.date || new Date().toISOString().split("T")[0];
      const category = ocr?.category || "Other";

      // ── Insert invoice (CAPTURED). Classify (below) moves it to review. ──
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          user_id: userId,
          vendor,
          amount,
          date,
          category,
          invoice_number: ocr?.invoiceNumber ?? null,
          // Workstream B: is_hsa_eligible and lifecycle_status are now derived
          // from the facets and reject direct writes. An OCR guess is not a
          // user confirmation, so eligibility stays 'unknown' until
          // substantiation; the email arrived with a document, so
          // documentation_state reflects that and yields 'pending_review'.
          eligibility_state: "unknown",
          documentation_state: "complete",
          claim_state: "unclaimed",
          amount_paid: amount,
          reimbursable_amount: amount,
          patient_name: null, // unknown from email; user sets during review
          source: "email",
          source_email_message_id: dedupeKey,
          source_email_received_at: receivedAt,
          notes: data.subject ? `Emailed receipt: ${data.subject}` : null,
        })
        .select("id")
        .single();
      if (invErr) {
        // 23505 = unique_violation on the dedupe index: already captured.
        if (invErr.code === "23505") continue;
        console.warn("[inbound-email] invoice insert failed:", invErr.message);
        continue;
      }

      // ── Upload file to Storage + receipt row (same layout as wizard) ─────
      const filePath = `${userId}/${invoice.id}/${Date.now()}-${att.filename}`;
      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(filePath, bytes, { contentType: att.content_type });
      if (upErr) {
        console.warn("[inbound-email] storage upload failed:", upErr.message);
      }
      const { data: receipt } = await supabase
        .from("receipts")
        .insert({
          invoice_id: invoice.id,
          user_id: userId,
          file_path: filePath,
          file_type: att.content_type,
          document_type: "bill",
          description: data.subject?.trim() || null,
        })
        .select("id")
        .single();

      if (ocr && receipt) {
        await supabase.from("receipt_ocr_data").insert({
          receipt_id: receipt.id,
          extracted_amount: ocr.amount,
          extracted_vendor: ocr.vendor,
          extracted_date: ocr.date,
          extracted_category: ocr.category,
          confidence_score: ocr.confidence,
          extracted_invoice_number: ocr.invoiceNumber,
          extracted_insurance: ocr.insurance,
          extracted_service_date: ocr.serviceDate,
          extracted_bill_date: ocr.billDate,
          metadata_confidence: ocr.metadataConfidence,
          extraction_warnings: ocr.warnings,
          raw_response: ocr.rawResponse,
        });

        // Classify only when OCR gave us real signal — moves CAPTURED ->
        // PENDING_REVIEW (or NEEDS_RECEIPT). PDFs/HEIC stay CAPTURED.
        try {
          await classifyAndPersist(supabase, {
            invoiceId: invoice.id,
            vendor,
            amount,
            date,
            category,
            notes: null,
            patientName: null,
            ocr: {
              extractedVendor: ocr.vendor,
              extractedDate: ocr.date,
              extractedServiceDate: ocr.serviceDate,
              extractedInvoiceNumber: ocr.invoiceNumber,
              extractedInsurance: ocr.insurance,
              metadataConfidence: ocr.metadataConfidence,
              extractionWarnings: ocr.warnings,
            },
          });
        } catch (e) {
          console.warn(
            "[inbound-email] classify failed; invoice stays CAPTURED:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      captured++;
    }

    console.log("[inbound-email] captured", captured, "receipt(s)");
    return new Response(JSON.stringify({ received: true, captured }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Ack 200 after verification: a logic bug should surface in logs, not a
    // retry storm. (PHI-safe: log message only, never the email contents.)
    console.error(
      "[inbound-email] Error:",
      error instanceof Error ? error.message : "unknown",
    );
    return new Response(JSON.stringify({ received: true, error: "logged" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
