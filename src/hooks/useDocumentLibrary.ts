// The person's saved documents, with what the scan read from each and which
// expenses each one backs -- what "Choose from Documents" lists and what
// "Looks like a match" is chosen from (SUBSTANTIATE_SPEC S3, S4).
//
// One query, shared by the picker and the offer, so the two can never
// disagree about what matches. Under the ["documents"] key, which the scan and
// every attach invalidate.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  clearMatch,
  rankForPicker,
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
  scan: (MatchableScan & { extracted_vendor: string | null }) | null;
  /** Every expense this document is attached to. */
  invoiceIds: string[];
}

/** The name the person knows a document by. */
export function documentName(
  doc: Pick<LibraryDocument, "file_name" | "description">,
): string {
  return doc.file_name ?? doc.description ?? "Untitled document";
}

/** A long library is cut at the newest thousand (CLAUDE.md: 500-1000). */
const LIBRARY_LIMIT = 1000;

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

      const [{ data: docs, error }, { data: links, error: linksError }] =
        await Promise.all([
          supabase
            .from("receipts")
            .select(
              "id, file_path, file_name, file_type, document_type, description, uploaded_at, receipt_ocr_data(scan_status, extracted_amount, extracted_vendor, extracted_date, extracted_bill_date, extracted_service_date, extracted_service_date_end)",
            )
            .eq("user_id", user.id)
            .order("uploaded_at", { ascending: false })
            .limit(LIBRARY_LIMIT),
          supabase
            .from("receipt_invoices")
            .select("receipt_id, invoice_id")
            .eq("user_id", user.id),
        ]);
      if (error) throw error;
      if (linksError) throw linksError;

      const backs = new Map<string, string[]>();
      for (const l of links ?? []) {
        backs.set(l.receipt_id, [
          ...(backs.get(l.receipt_id) ?? []),
          l.invoice_id,
        ]);
      }

      return (docs ?? []).map(({ receipt_ocr_data, ...d }) => {
        const joined = receipt_ocr_data as unknown;
        const scan = (Array.isArray(joined) ? joined[0] : joined) as
          LibraryDocument["scan"] | undefined;
        return { ...d, scan: scan ?? null, invoiceIds: backs.get(d.id) ?? [] };
      });
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
      const { data, error } = await supabase
        .from("invoices")
        .select("date, amount, amount_paid, mileage_miles")
        .eq("id", invoiceId!)
        .single();
      if (error) throw error;
      // A mileage log is proved by its own working; no document matches it.
      if (data.mileage_miles != null) return null;
      const amounts = [data.amount, data.amount_paid]
        .filter((a): a is number => a != null)
        .map(Number);
      return { paidDate: data.date, amounts };
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
      const here = d.invoiceIds.filter((id) => targets.has(id)).length;
      return {
        ...d,
        attachedHereCount: here,
        attachedElsewhere: d.invoiceIds.length - here,
      };
    })
    .filter((d) => d.attachedHereCount < targets.size);

  return {
    ...rankForPicker(pickable, charge.data ?? null),
    isLoading: library.isLoading || (!!single && charge.isLoading),
    isError: library.isError,
  };
}

/** The one saved document that clearly matches this expense, if any (S4). */
export function useClearMatch(invoiceId: string) {
  const library = useDocumentLibrary();
  const charge = useCharge(invoiceId);
  const candidates = (library.data ?? [])
    .filter((d) => !d.invoiceIds.includes(invoiceId))
    .map((d) => ({ ...d, attachedElsewhere: d.invoiceIds.length }));
  return clearMatch(candidates, charge.data ?? null);
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
