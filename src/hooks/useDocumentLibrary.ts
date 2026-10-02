// The person's saved documents, with what the scan read from each and which
// expenses each one backs -- what "Choose from Documents" lists, what
// "Looks like a match" is chosen from (SUBSTANTIATE_SPEC S3, S4), and what the
// Documents page shows.
//
// One query, shared by all three, so they can never disagree about what
// matches. Under the ["documents"] key, which the scan and every attach
// invalidate.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useScanDocument } from "@/hooks/useDocumentScan";
import {
  documentsToCatchUp,
  likelyMatches,
  rankForPicker,
  type Backing,
  type Charge,
  type MatchableScan,
} from "@/lib/documentMatch";

export interface LibraryDocument {
  id: string;
  file_path: string;
  file_name: string | null;
  file_type: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
  scan: MatchableScan | null;
  /** Every expense this document is attached to, with what matching needs
   *  to know about it (a payment plan is recognised by these, S3/S4). */
  backs: Backing[];
}

/** The name the person knows a document by. */
export function documentName(
  doc: Pick<LibraryDocument, "file_name" | "description">,
): string {
  return doc.file_name ?? doc.description ?? "Untitled document";
}

/** A long library is cut at the newest thousand (CLAUDE.md: 500-1000). */
const LIBRARY_LIMIT = 1000;

/** One joined row, whichever shape PostgREST returned it in. */
function one<T>(joined: T | T[] | null | undefined): T | null {
  if (!joined) return null;
  return Array.isArray(joined) ? (joined[0] ?? null) : joined;
}

export function useDocumentLibrary(enabled = true) {
  return useQuery({
    queryKey: ["documents", "library"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LibraryDocument[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // The expenses each document backs come embedded, so they are bounded
      // by the same limit as the documents themselves.
      const { data, error } = await supabase
        .from("receipts")
        .select(
          "id, file_path, file_name, file_type, document_type, description, uploaded_at, receipt_ocr_data(scan_status, extracted_amount, extracted_vendor, extracted_date, extracted_bill_date, extracted_service_date, extracted_service_date_end), receipt_invoices(invoice_id, invoices(vendor, vendor_original, amount, amount_paid))",
        )
        .eq("user_id", user.id)
        .order("uploaded_at", { ascending: false })
        .limit(LIBRARY_LIMIT);
      if (error) throw error;

      return (data ?? []).map(
        ({ receipt_ocr_data, receipt_invoices, ...d }) => ({
          ...d,
          scan: one(receipt_ocr_data as unknown as MatchableScan | null),
          backs: (receipt_invoices ?? []).map((link) => {
            const inv = one(link.invoices);
            const paid = inv?.amount_paid ?? inv?.amount;
            return {
              invoiceId: link.invoice_id,
              vendor: inv?.vendor ?? null,
              vendorOriginal: inv?.vendor_original ?? null,
              amount: paid == null ? null : Number(paid),
            };
          }),
        }),
      );
    },
  });
}

/** The payment one expense records, for matching documents against. */
export function useCharge(invoiceId: string | null) {
  return useQuery({
    queryKey: ["match-charge", invoiceId],
    enabled: !!invoiceId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Charge | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Row-level security already limits this to the caller's expenses;
      // user_id is checked as well so the ownership rule is visible here.
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "date, amount, amount_paid, mileage_miles, vendor, vendor_original, transactions!invoices_source_transaction_id_fkey(amount, transaction_date)",
        )
        .eq("id", invoiceId!)
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      // A mileage log is proved by its own working; no document matches it.
      if (data.mileage_miles != null) return null;

      // One share of a split carries only its share and its date of care; the
      // receipt shows the whole bank charge, on the day it was paid.
      const txn = one(data.transactions);
      const amounts = [data.amount, data.amount_paid, txn?.amount]
        .filter((a): a is number => a != null)
        .map((a) => Math.abs(Number(a)));
      return {
        invoiceId: invoiceId!,
        paidDate: txn?.transaction_date ?? data.date,
        amounts,
        providerNames: [data.vendor_original, data.vendor].filter(
          (n): n is string => !!n,
        ),
      };
    },
  });
}

/**
 * The library as the picker shows it for these expenses: documents already on
 * every one of them left out, and -- for a single expense -- likely matches
 * first (S3). Attaching to several at once (the queue's bulk bar) ranks
 * nothing: there is no one payment to match.
 */
export function usePickableDocuments(invoiceIds: string[], enabled: boolean) {
  const single = invoiceIds.length === 1 ? invoiceIds[0] : null;
  const library = useDocumentLibrary(enabled);
  const charge = useCharge(enabled ? single : null);

  const targets = new Set(invoiceIds);
  const pickable = (library.data ?? [])
    .map((d) => {
      const here = d.backs.filter((b) => targets.has(b.invoiceId)).length;
      return {
        ...d,
        attachedHereCount: here,
        attachedElsewhereCount: d.backs.length - here,
      };
    })
    .filter((d) => d.attachedHereCount < targets.size);

  return {
    ...rankForPicker(pickable, charge.data ?? null),
    isLoading: library.isLoading || (!!single && charge.isLoading),
    error: library.error,
  };
}

/** Saved documents that look like the proof for this expense (S4). */
export function useLikelyMatches(invoiceId: string): LibraryDocument[] {
  const library = useDocumentLibrary();
  const charge = useCharge(invoiceId);
  return likelyMatches(library.data ?? [], charge.data ?? null);
}

// This visit's catch-up. Module-level, not per component, so a remount of the
// Documents page does not start a second reader over the same files.
const caughtUp = new Set<string>();
/** Uploads reading themselves: skipped, but not counted against the cap. */
const claimed = new Set<string>();
let catchingUp = false;
/** Set on the first failure: nothing more is tried until the next visit. */
let catchUpStopped = false;

/** Documents another path is reading right now (a fresh upload): the
 *  catch-up leaves them alone, so no file is read twice. */
export function claimForReading(receiptIds: string[]) {
  for (const id of receiptIds) claimed.add(id);
}

/**
 * Read, in the background, saved documents that were never read and are on no
 * expense -- uploads from before reading at upload existed (S6) -- so they can
 * be matched (S3, S4). Used by the Documents page only (founder's call,
 * 2026-10-02): reading happens while the person is looking at their
 * documents, never just because an expense was opened.
 *
 * One at a time, at most CATCH_UP_PER_SESSION a visit. The first failure ends
 * it for the visit -- if the service is down, the rest would only repeat the
 * failure -- silently, since nobody asked for this read. A reload tries again.
 */
export function useCatchUpReadings() {
  const library = useDocumentLibrary();
  const { mutateAsync } = useScanDocument();

  useEffect(() => {
    if (catchingUp || catchUpStopped || !library.data) return;
    const todo = documentsToCatchUp(library.data, caughtUp, claimed);
    if (todo.length === 0) return;

    catchingUp = true;
    void (async () => {
      try {
        for (const doc of todo) {
          caughtUp.add(doc.id);
          try {
            await mutateAsync({ receiptId: doc.id, quiet: true });
          } catch {
            catchUpStopped = true;
            break;
          }
        }
      } finally {
        catchingUp = false;
      }
    })();
  }, [library.data, mutateAsync]);
}

/**
 * Short-lived links to show image documents as thumbnails (S3), fetched in one
 * request for the whole list. The bucket is private, so every image needs one.
 */
export function useThumbnailUrls(
  docs: { file_path: string; file_type: string }[],
) {
  const paths = docs
    .filter((d) => d.file_type.startsWith("image/"))
    .map((d) => d.file_path)
    .sort();
  return useQuery({
    queryKey: ["document-thumbnails", paths],
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrls(paths, 60 * 60);
      if (error) throw error;
      const urls = new Map<string, string>();
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
      }
      return urls;
    },
  }).data;
}

/**
 * Attach saved documents to expenses. Attaching one already there is a no-op,
 * which carries the bulk case where some of the expenses already had it.
 */
export function useAttachDocuments() {
  const queryClient = useQueryClient();
  return async (receiptIds: string[], invoiceIds: string[]) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const links = invoiceIds.flatMap((invoiceId) =>
      receiptIds.map((receiptId) => ({
        receipt_id: receiptId,
        invoice_id: invoiceId,
        user_id: user.id,
      })),
    );
    const { error } = await supabase.from("receipt_invoices").upsert(links, {
      onConflict: "receipt_id,invoice_id",
      ignoreDuplicates: true,
    });
    if (error) throw error;
    // What each document backs has changed, so what matches has too.
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
  };
}
