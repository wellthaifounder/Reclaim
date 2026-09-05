// Substantiate an expense without leaving the list.
//
// Substantiating used to mean a page change: leave the expense list, land on
// the detail page, work, navigate back, lose your place. That is a heavy
// journey for what is usually "attach the photo I already have and confirm two
// dates", and it is the step users have to repeat most.
//
// So it is a dialog over the list. Three bands, in the order the work happens:
//
//   1. What the bank saw   -- immutable. Provider, amount, date. Shown, never
//                             edited: this came from the transaction and is
//                             the anchor everything else is checked against.
//   2. Documents           -- attach a file, or reuse one already on file. An
//                             image can be read by OCR, which fills the fields
//                             below as SUGGESTIONS the user accepts. The spec
//                             is explicit that OCR never silently overwrites.
//   3. Substantiation      -- dates of service, patient, tags, reimbursable
//                             amount, and the three eligibility gates. This is
//                             the existing SubstantiationPanel, unchanged --
//                             the same component the detail page uses, so the
//                             two surfaces cannot drift apart.
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/ui/money";
import {
  Loader2,
  Upload,
  Camera,
  Sparkles,
  Check,
  X,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import { validateFiles } from "@/utils/fileValidation";
import { formatDateOnly } from "@/lib/dates";
import { SubstantiationPanel } from "@/components/expense/SubstantiationPanel";
import { ReceiptGallery } from "@/components/expense/ReceiptGallery";

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

  const { data: expense, isLoading } = useQuery({
    queryKey: ["substantiate-expense", expenseId],
    enabled: open && !!expenseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, vendor, amount, date, service_date, service_date_end, patient_id, reimbursable_amount, eligibility_state, documentation_state",
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
      const { data, error } = await supabase
        .from("receipts")
        .select(
          "id, file_path, file_type, document_type, description, display_order, uploaded_at",
        )
        .eq("invoice_id", expenseId!)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

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
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      for (const file of valid) {
        const path = `${user.id}/${expenseId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, file);
        if (upErr) throw upErr;

        const { error: rowErr } = await supabase.from("receipts").insert({
          invoice_id: expenseId,
          user_id: user.id,
          file_path: path,
          file_type: file.type,
          document_type: "receipt",
        });
        if (rowErr) throw rowErr;
      }

      toast.success(
        valid.length === 1
          ? "Document added"
          : `${valid.length} documents added`,
      );
      await refetchReceipts();
      // documentation_state is recomputed by a trigger when receipts change,
      // so anything showing this expense's status needs to re-read it.
      queryClient.invalidateQueries({ queryKey: ["substantiate-expense"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });

      // Offer to read the first image straight away -- that is the moment the
      // file is in hand and the user is still thinking about this expense.
      const firstImage = valid.find((f) => f.type.startsWith("image/"));
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Substantiate this expense</DialogTitle>
          <DialogDescription>
            Attach what proves it, then confirm who it was for and when. You can
            close this at any point — everything saves as you go.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !expense ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* 1. What the bank saw. Read-only on purpose. */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{expense.vendor}</p>
                  <p className="text-sm text-muted-foreground">
                    Paid {formatDateOnly(expense.date)}
                  </p>
                </div>
                <Money
                  value={Number(expense.amount)}
                  className="text-lg font-semibold shrink-0"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                From your bank, so it can't be edited here.
              </p>
            </div>

            {/* 2. Documents. */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Documents</h3>
                {expense.documentation_state && (
                  <Badge variant="outline" className="capitalize">
                    {expense.documentation_state === "none"
                      ? "Nothing attached"
                      : expense.documentation_state}
                  </Badge>
                )}
              </div>

              {receipts && receipts.length > 0 && (
                <ReceiptGallery
                  expenseId={expense.id}
                  receipts={receipts}
                  onReceiptDeleted={() => void refetchReceipts()}
                  onReceiptUpdated={() => void refetchReceipts()}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.pdf,.gif,.webp,image/*,application/pdf"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      void handleUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-5 text-sm hover:border-primary hover:bg-accent/40 transition-colors">
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Upload className="h-5 w-5" />
                    )}
                    <span>{uploading ? "Uploading…" : "Upload a file"}</span>
                  </div>
                </label>

                <label className="cursor-pointer">
                  {/* `capture` asks a phone for the camera directly. On desktop
                      it degrades to a normal file picker, which is why this is
                      a second input rather than a separate code path. */}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      void handleUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-5 text-sm hover:border-primary hover:bg-accent/40 transition-colors">
                    <Camera className="h-5 w-5" />
                    <span>Take a photo</span>
                  </div>
                </label>
              </div>

              {scanning && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Reading the receipt…
                </p>
              )}

              {/* OCR output is a proposal, never an overwrite. The user sees
                  the old and new value and decides. */}
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
                            <span className="font-medium">{suggestedDate}</span>
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
                      <Button size="sm" onClick={() => void acceptSuggestion()}>
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

              {(!receipts || receipts.length === 0) && !uploading && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  An itemised statement showing the provider, date of service,
                  patient and amount is what the IRS would ask for. You can
                  claim without one — this is a note, not a block.
                </p>
              )}
            </section>

            <Separator />

            {/* 3. The existing substantiation step, unchanged. */}
            <SubstantiationPanel
              hideHeader
              invoiceId={expense.id}
              amountPaid={Number(expense.amount)}
              reimbursableAmount={
                expense.reimbursable_amount == null
                  ? null
                  : Number(expense.reimbursable_amount)
              }
              serviceDate={expense.service_date}
              serviceDateEnd={expense.service_date_end}
              patientId={expense.patient_id}
              onSaved={() => {
                queryClient.invalidateQueries({
                  queryKey: ["substantiate-expense"],
                });
                queryClient.invalidateQueries({ queryKey: ["bills"] });
              }}
            />

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
