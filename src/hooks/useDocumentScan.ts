// The scan, from the browser's side (SUBSTANTIATE_SPEC S7, S8, S24).
//
// Every document that lands on an expense -- an upload, a photo, a pick from
// Documents, an Undo, Scan again -- goes through `scan-document`, which reads
// the stored file (images and PDFs), keeps the reading with the document, fills
// the expense's gaps and re-runs the IRS-category check.
//
// A mutation rather than local state, so whichever component shows the
// document can tell it is being read (useScanningIds): the upload starts in the
// dialog, but "Reading your document…" belongs on the document's own row.

import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

const SCAN_KEY = ["scan-document"] as const;

export interface ScanVars {
  receiptId: string;
  invoiceId: string;
  /** Scan again: read the file even though a reading is kept. */
  rescan?: boolean;
}

export interface ScanOutcome {
  status: "read" | "unreadable";
  filled: string[];
  classified: boolean;
}

/** What a document's scan says, as the receipts queries return it. */
export interface DocumentScan {
  scan_status: string;
  extracted_items?: unknown;
  extracted_patient?: string | null;
}

/** The kept reading, whichever shape the join came back in. */
export function scanOf(receipt: {
  receipt_ocr_data?: DocumentScan | DocumentScan[] | null;
}): DocumentScan | null {
  const joined = receipt.receipt_ocr_data;
  if (!joined) return null;
  return Array.isArray(joined) ? (joined[0] ?? null) : joined;
}

/** What the document says was bought or done. */
export function itemsOf(scan: DocumentScan | null): string[] {
  const items = scan?.extracted_items;
  return Array.isArray(items)
    ? items.filter((i): i is string => typeof i === "string")
    : [];
}

/** The receipts query columns that carry the scan. */
export const SCAN_COLUMNS =
  "receipt_ocr_data(scan_status, extracted_items, extracted_patient)";

export function useScanDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: SCAN_KEY,
    mutationFn: async ({
      receiptId,
      invoiceId,
      rescan = false,
    }: ScanVars): Promise<ScanOutcome> => {
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { receipt_id: receiptId, invoice_id: invoiceId, rescan },
      });
      if (error || !data?.success) throw error ?? new Error("Scan failed");
      return data as ScanOutcome;
    },
    onSettled: (_data, _error, { invoiceId }) => {
      // The scan can change the document (its reading, its type), the expense
      // (date, patient, provider) and the category check, and every list that
      // shows any of them.
      for (const key of [
        ["substantiate-receipts", invoiceId],
        ["receipts", invoiceId],
        ["substantiate-expense"],
        ["bill", invoiceId],
        ["bills"],
        ["invoices"],
        ["eligibility-gates", invoiceId],
        ["substantiate-queue"],
        ["all-expenses"],
        ["documents"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => {
      // Not the document's fault -- the service is busy or unreachable. A
      // document the scan genuinely cannot read comes back as a success with
      // status "unreadable" and is marked on its own row instead.
      logError("Scanning a document failed", error);
      toast.error("We couldn't scan that document just now.", {
        description: "It's attached. Use Scan again in a moment.",
      });
    },
  });
}

/** Documents being read right now, from anywhere in the app. */
export function useScanningIds(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: SCAN_KEY, status: "pending" },
    select: (m) => (m.state.variables as ScanVars | undefined)?.receiptId,
  });
  return new Set(ids.filter((id): id is string => !!id));
}

/**
 * Scan documents just attached to one or more expenses.
 *
 * Each document is read once: the first expense waits for the reading, and the
 * rest reuse it (the server skips the AI read when one is kept, S11). Firing
 * them all at once would read the same file once per expense.
 */
export function useScanAttached() {
  const scan = useScanDocument();
  return (receiptIds: string[], invoiceIds: string[]) => {
    for (const receiptId of receiptIds) {
      const [first, ...rest] = invoiceIds;
      if (!first) continue;
      void scan
        .mutateAsync({ receiptId, invoiceId: first })
        .catch(() => undefined)
        .then(() => {
          for (const invoiceId of rest) {
            scan.mutate({ receiptId, invoiceId });
          }
        });
    }
  };
}
