// Substantiate an expense without leaving the list.
//
// Substantiating used to mean a page change: leave the expense list, land on
// the detail page, work, navigate back, lose your place. That is a heavy
// journey for what is usually "attach the photo I already have and confirm two
// dates", and it is the step users have to repeat most.
//
// So it is a dialog over the list, laid out by SubstantiationPanel -- the same
// component the full expense page uses, so the two surfaces cannot drift apart
// (SUBSTANTIATE_SPEC S35). In the order the work happens:
//
//   1. The payment         -- provider, when paid, the amount, and Claiming.
//                             What the bank recorded is shown, never edited.
//   2. Documents           -- attach a file, or reuse one already on file
//                             (DocumentAttachOptions, S1/S2), or take the
//                             saved one that clearly matches the charge
//                             (LikelyMatchOffer, S4). Every document
//                             that arrives is scanned by itself, PDFs too
//                             (S7): the scan fills the fields below where
//                             they are blank or still a default, and never
//                             overwrites what the person entered (S9).
//   3. Date of care, who it was for, tags -- every field already holds a
//                             sensible value and saves as it changes.
//   4. The decision        -- pinned in the footer: Confirm eligible / Not
//                             eligible (ExpenseDecision, S30-S33). Opened from
//                             the Substantiate queue, either button moves
//                             straight to the next expense, with a count
//                             (S31); opened anywhere else, it closes.
//
// Deliberately NOT a wizard. A wizard implies a start and a finish, but
// substantiation is resumable by nature: a receipt today, a service date when
// the statement arrives, a letter of medical necessity next month. Every field
// saves on its own and the dialog can be closed at any point without losing
// what was entered.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExpenseDecision } from "@/components/expense/ExpenseDecision";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import { validateFiles } from "@/utils/fileValidation";
import { toUploadableFile } from "@/utils/heicConversion";
import { SubstantiationPanel } from "@/components/expense/SubstantiationPanel";
import { mileageFromInvoice } from "@/lib/mileageBreakdown";
import { ProofNotices } from "@/components/expense/ProofNotices";
import { ReceiptGallery } from "@/components/expense/ReceiptGallery";
import { DocumentAttachOptions } from "@/components/expense/DocumentAttachOptions";
import { LikelyMatchOffer } from "@/components/expense/LikelyMatchOffer";
import { AttachDocumentDialog } from "@/components/documents/AttachDocumentDialog";
import { SCAN_COLUMNS, useScanAttached } from "@/hooks/useDocumentScan";
import { documentScanProps, qualifyingCategory } from "@/lib/documentScanProps";

interface SubstantiateDialogProps {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Set only when the dialog is working through the Substantiate queue (S31).
   * The queue owns which expense is open, so a decision hands control back to
   * it: it opens the next one, or closes the dialog after the last.
   */
  queue?: {
    position: { current: number; total: number };
    onDecided: () => void;
    onSkip: () => void;
  };
}

export function SubstantiateDialog({
  expenseId,
  open,
  onOpenChange,
  queue,
}: SubstantiateDialogProps) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  // The picker: null when closed, else the documents it opens with ticked --
  // none from "Choose from Documents", the matches from the offer's Review.
  const [choosing, setChoosing] = useState<string[] | null>(null);
  const scanAttached = useScanAttached();

  // The queue moves this dialog from one expense to the next without closing
  // it, so anything belonging to the previous expense is dropped. A scan
  // already running carries on: it belongs to its own expense.
  useEffect(() => {
    setChoosing(null);
  }, [expenseId]);

  const { data: expense, isLoading } = useQuery({
    queryKey: ["substantiate-expense", expenseId],
    enabled: open && !!expenseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, vendor, vendor_original, amount, amount_paid, date, service_date, service_date_end, service_date_source, patient_id, patient_source, reimbursable_amount, claim_state, eligibility_state, documentation_state, mileage_miles, mileage_rate, mileage_trips, mileage_parking_tolls, pub_502_rules(name, eligibility_status)",
        )
        .eq("id", expenseId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: receipts, refetch: refetchReceipts } = useQuery({
    queryKey: ["substantiate-receipts", expenseId],
    enabled: open && !!expenseId,
    queryFn: async () => {
      // Attachment lives in receipt_invoices now, not receipts.invoice_id --
      // a document can be shared with another expense, so filtering on the
      // legacy column here would miss anything attached only through the
      // multi-attach path (AttachDocumentDialog).
      const { data, error } = await supabase
        .from("receipts")
        .select(
          `id, file_path, file_type, document_type, description, display_order, uploaded_at, receipt_invoices!inner(invoice_id), ${SCAN_COLUMNS}`,
        )
        .eq("receipt_invoices.invoice_id", expenseId!)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // After anything that changes what is attached: an upload, a pick from the
  // library, a removal or its undo. documentation_state is recomputed by a
  // trigger on receipt_invoices, so anything showing this expense's status --
  // the dialog, the queue row, the lists -- needs to re-read it.
  const refreshDocuments = () => {
    void refetchReceipts();
    queryClient.invalidateQueries({ queryKey: ["substantiate-expense"] });
    queryClient.invalidateQueries({ queryKey: ["bills"] });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !expenseId) return;
    const { valid, invalid } = validateFiles(Array.from(files));
    if (invalid.length > 0) {
      toast.error(
        `${invalid.length} file(s) rejected: ${invalid[0].errors[0]}`,
      );
    }
    if (valid.length === 0) return;

    setUploading(true);

    // An iPhone photo arrives as HEIC, which neither the preview nor the
    // receipt scanner can read, so it becomes a JPEG before it is stored or
    // scanned. Handled on its own rather than inside the block below because
    // the message names the file that failed, and the catch there deliberately
    // does not repeat storage errors back to the user.
    let uploadable: File[];
    try {
      uploadable = await Promise.all(valid.map(toUploadableFile));
    } catch (e) {
      logError("Photo conversion failed", e);
      toast.error(
        e instanceof Error ? e.message : "We couldn't read that photo.",
      );
      setUploading(false);
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const added: string[] = [];
      for (const file of uploadable) {
        const path = `${user.id}/${expenseId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, file);
        if (upErr) throw upErr;

        // "receipt" is only where it starts: nobody chose it, so the scan may
        // say what it really is -- a letter of medical necessity, say (S10).
        const { data: row, error: rowErr } = await supabase
          .from("receipts")
          .insert({
            invoice_id: expenseId,
            user_id: user.id,
            file_path: path,
            file_name: file.name,
            file_type: file.type,
            document_type: "receipt",
          })
          .select("id")
          .single();
        if (rowErr) throw rowErr;
        added.push(row.id);
      }

      toast.success(
        uploadable.length === 1
          ? "Document added"
          : `${uploadable.length} documents added`,
      );
      refreshDocuments();
      // Read every one, PDFs included, while the person carries on (S7).
      scanAttached(added, [expenseId]);
    } catch (e) {
      logError("Receipt upload failed", e);
      toast.error("We couldn't save that document. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const hasDocuments = !!receipts && receipts.length > 0;
  const scanProps = documentScanProps(receipts);
  // The payment the bank recorded. amount_paid is what the claim cap is
  // checked against, and is smaller than amount for one slice of a split.
  const amountPaid = expense
    ? Number(expense.amount_paid ?? expense.amount)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No description under the title (S29): the layout says what to do.
          aria-describedby is cleared so the missing one is deliberate, not a
          warning. */}
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>Substantiate this expense</DialogTitle>
        </DialogHeader>

        {isLoading || !expense ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <SubstantiationPanel
              hideHeader
              key={expense.id}
              invoiceId={expense.id}
              vendor={expense.vendor}
              vendorOriginal={expense.vendor_original}
              paidDate={expense.date}
              amountPaid={amountPaid}
              claimState={expense.claim_state}
              reimbursableAmount={
                expense.reimbursable_amount == null
                  ? null
                  : Number(expense.reimbursable_amount)
              }
              serviceDate={expense.service_date}
              serviceDateEnd={expense.service_date_end}
              patientId={expense.patient_id}
              serviceDateSource={expense.service_date_source}
              patientSource={expense.patient_source}
              {...scanProps}
              mileage={mileageFromInvoice(expense)}
              onSaved={() => {
                queryClient.invalidateQueries({
                  queryKey: ["substantiate-expense"],
                });
                queryClient.invalidateQueries({ queryKey: ["bills"] });
              }}
              documents={
                <section className="space-y-3">
                  <h3 className="font-medium">Documents</h3>

                  {hasDocuments && (
                    <ReceiptGallery
                      expenseId={expense.id}
                      receipts={receipts}
                      onReceiptDeleted={refreshDocuments}
                      onReceiptUpdated={() => void refetchReceipts()}
                    />
                  )}

                  <ProofNotices
                    invoiceId={expense.id}
                    hasDocuments={hasDocuments}
                    isMileage={expense.mileage_miles != null}
                    noReceipt={expense.documentation_state === "not_available"}
                  />

                  {/* Saved documents that look like the proof are offered
                      before the picker is opened (S4). */}
                  <LikelyMatchOffer
                    key={expense.id}
                    invoiceId={expense.id}
                    onAttached={(receiptIds) => {
                      refreshDocuments();
                      scanAttached(receiptIds, [expense.id]);
                    }}
                    onReview={setChoosing}
                  />

                  <DocumentAttachOptions
                    uploading={uploading}
                    onFiles={(files) => void handleUpload(files)}
                    onChooseFromDocuments={() => setChoosing([])}
                  />
                </section>
              }
            />
          </div>
        )}

        {/* Pinned, so the decision is never scrolled out of reach (S30). */}
        {expense && (
          <div className="border-t px-6 py-4">
            <ExpenseDecision
              key={expense.id}
              invoiceId={expense.id}
              eligibilityState={expense.eligibility_state}
              claimState={expense.claim_state}
              category={qualifyingCategory(expense.pub_502_rules)}
              position={queue?.position}
              onSkip={queue?.onSkip}
              onDecided={() =>
                queue ? queue.onDecided() : onOpenChange(false)
              }
            />
          </div>
        )}

        {/* Inside the content, not beside it, so the picker is a child layer
            of this dialog: a click in it is not a click outside this one. */}
        {expenseId && (
          <AttachDocumentDialog
            invoiceIds={[expenseId]}
            open={choosing !== null}
            onOpenChange={(open) => !open && setChoosing(null)}
            preselected={choosing ?? undefined}
            onAttached={(receiptIds) => {
              refreshDocuments();
              // Chosen from the library is attached like any other (S7); a
              // document already read fills the form without a second read.
              scanAttached(receiptIds, [expenseId]);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
