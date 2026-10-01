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
//                             (DocumentAttachOptions, S1/S2). An image can be
//                             read by OCR, which fills the fields below as
//                             SUGGESTIONS the user accepts, for now; the scan
//                             slice moves that to "fills gaps, never
//                             overwrites" (S9).
//   3. Date of care, who it was for, tags -- every field already holds a
//                             sensible value and saves as it changes.
//
// Deliberately NOT a wizard. A wizard implies a start and a finish, but
// substantiation is resumable by nature: a receipt today, a service date when
// the statement arrives, a letter of medical necessity next month. Every field
// saves on its own and the dialog can be closed at any point without losing
// what was entered.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import { validateFiles } from "@/utils/fileValidation";
import { toUploadableFile } from "@/utils/heicConversion";
import { SubstantiationPanel } from "@/components/expense/SubstantiationPanel";
import { mileageFromInvoice } from "@/lib/mileageBreakdown";
import { ProofNotices } from "@/components/expense/ProofNotices";
import { ReceiptGallery } from "@/components/expense/ReceiptGallery";
import { DocumentAttachOptions } from "@/components/expense/DocumentAttachOptions";
import { AttachDocumentDialog } from "@/components/documents/AttachDocumentDialog";

interface SubstantiateDialogProps {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What process-receipt-ocr gives back, narrowed to the fields we offer. */
interface OcrSuggestion {
  vendor: string | null;
  serviceDate: string | null;
  date: string | null;
  amount: number | null;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function SubstantiateDialog({
  expenseId,
  open,
  onOpenChange,
}: SubstantiateDialogProps) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [suggestion, setSuggestion] = useState<OcrSuggestion | null>(null);
  const [choosing, setChoosing] = useState(false);

  const { data: expense, isLoading } = useQuery({
    queryKey: ["substantiate-expense", expenseId],
    enabled: open && !!expenseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, vendor, amount, amount_paid, date, service_date, service_date_end, patient_id, reimbursable_amount, claim_state, eligibility_state, documentation_state, mileage_miles, mileage_rate, mileage_trips, mileage_parking_tolls",
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
          "id, file_path, file_type, document_type, description, display_order, uploaded_at, receipt_invoices!inner(invoice_id)",
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

      for (const file of uploadable) {
        const path = `${user.id}/${expenseId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, file);
        if (upErr) throw upErr;

        const { error: rowErr } = await supabase.from("receipts").insert({
          invoice_id: expenseId,
          user_id: user.id,
          file_path: path,
          file_name: file.name,
          file_type: file.type,
          document_type: "receipt",
        });
        if (rowErr) throw rowErr;
      }

      toast.success(
        uploadable.length === 1
          ? "Document added"
          : `${uploadable.length} documents added`,
      );
      refreshDocuments();

      // Offer to read the first image straight away -- that is the moment the
      // file is in hand and the user is still thinking about this expense.
      const firstImage = uploadable.find((f) => f.type.startsWith("image/"));
      if (firstImage) void runOcr(firstImage);
    } catch (e) {
      logError("Receipt upload failed", e);
      toast.error("We couldn't save that document. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const runOcr = async (file: File) => {
    setScanning(true);
    setSuggestion(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke(
        "process-receipt-ocr",
        { body: { imageBase64 } },
      );
      if (error || !data?.success) {
        toast.error(
          "We couldn't read that image. You can type the details in.",
        );
        return;
      }
      const r = data.data as OcrSuggestion;
      // Only offer what we actually got and what would change something.
      const useful =
        (r.vendor && r.vendor !== expense?.vendor) ||
        (r.serviceDate ?? r.date) !== expense?.service_date;
      if (!useful) {
        toast.success("Receipt read — it matches what's already here.");
        return;
      }
      setSuggestion(r);
    } catch (e) {
      logError("Receipt OCR failed", e);
      toast.error("We couldn't read that image. You can type the details in.");
    } finally {
      setScanning(false);
    }
  };

  const acceptSuggestion = async () => {
    if (!suggestion || !expenseId) return;
    const patch: Record<string, string> = {};
    if (suggestion.vendor) patch.vendor = suggestion.vendor;
    const svc = suggestion.serviceDate ?? suggestion.date;
    if (svc) patch.service_date = svc;
    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", expenseId);
    if (error) {
      logError("Applying OCR suggestion failed", error);
      toast.error("We couldn't apply those details.");
      return;
    }
    toast.success("Details applied");
    setSuggestion(null);
    queryClient.invalidateQueries({ queryKey: ["substantiate-expense"] });
    queryClient.invalidateQueries({ queryKey: ["bills"] });
  };

  const suggestedDate = suggestion
    ? (suggestion.serviceDate ?? suggestion.date)
    : null;

  const hasDocuments = !!receipts && receipts.length > 0;
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
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Substantiate this expense</DialogTitle>
        </DialogHeader>

        {isLoading || !expense ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <SubstantiationPanel
              hideHeader
              key={expense.id}
              invoiceId={expense.id}
              vendor={expense.vendor}
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
                  />

                  <DocumentAttachOptions
                    uploading={uploading}
                    onFiles={(files) => void handleUpload(files)}
                    onChooseFromDocuments={() => setChoosing(true)}
                  />

                  {scanning && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Sparkles className="h-4 w-4 animate-pulse" />
                      Reading the receipt…
                    </p>
                  )}

                  {/* OCR output is a proposal, never an overwrite. The user
                      sees the old and new value and decides. */}
                  {suggestion && (
                    <Alert>
                      <Sparkles className="h-4 w-4" />
                      <AlertDescription className="space-y-3">
                        <p className="font-medium">
                          We read this from the receipt:
                        </p>
                        <ul className="text-sm space-y-1">
                          {suggestion.vendor &&
                            suggestion.vendor !== expense.vendor && (
                              <li>
                                Provider:{" "}
                                <span className="font-medium">
                                  {suggestion.vendor}
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  (was {expense.vendor})
                                </span>
                              </li>
                            )}
                          {suggestedDate &&
                            suggestedDate !== expense.service_date && (
                              <li>
                                Date of service:{" "}
                                <span className="font-medium">
                                  {suggestedDate}
                                </span>
                                {expense.service_date && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    (was {expense.service_date})
                                  </span>
                                )}
                              </li>
                            )}
                        </ul>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void acceptSuggestion()}
                          >
                            <Check className="h-3.5 w-3.5 mr-1.5" />
                            Use these
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSuggestion(null)}
                          >
                            <X className="h-3.5 w-3.5 mr-1.5" />
                            Keep what I have
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </section>
              }
            />

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Inside the content, not beside it, so the picker is a child layer
            of this dialog: a click in it is not a click outside this one. */}
        {expenseId && (
          <AttachDocumentDialog
            invoiceIds={[expenseId]}
            open={choosing}
            onOpenChange={setChoosing}
            onAttached={refreshDocuments}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
