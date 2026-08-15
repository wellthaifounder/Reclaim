import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import {
  Loader2,
  ShieldCheck,
  Calendar,
  DollarSign,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { generateReimbursementPDF } from "@/lib/pdfGenerator";

const HSA_PROVIDERS = [
  "HSA Bank",
  "HealthEquity",
  "Fidelity HSA",
  "Optum Bank",
  "Lively",
  "WageWorks",
  "PayFlex",
  "Further",
  "Other",
];

interface ClaimEntry {
  invoice_id: string;
  vendor: string;
  category: string;
  service_date: string;
  amount: number;
}

interface ClaimHSADialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ClaimEntry[];
  /** If claiming for a specific care event */
  collectionId?: string;
  collectionTitle?: string;
  onSuccess: () => void;
}

export function ClaimHSADialog({
  open,
  onOpenChange,
  entries,
  collectionId,
  collectionTitle,
  onSuccess,
}: ClaimHSADialogProps) {
  const queryClient = useQueryClient();
  const [hsaProvider, setHsaProvider] = useState("");
  const [notes, setNotes] = useState("");

  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

  const claimMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Generate PDF
      const pdfBlob = await generateReimbursementPDF({
        expenses: entries.map((e) => ({
          id: e.invoice_id,
          date: e.service_date,
          vendor: e.vendor,
          amount: e.amount,
          category: e.category,
          notes: null,
        })),
        totalAmount,
        notes: notes || undefined,
        hsaProvider: hsaProvider || undefined,
        userName: user.user_metadata?.full_name || user.email || "HSA Member",
        userEmail: user.email || "",
      });

      // Create reimbursement request (linked to care event if applicable)
      const { data: request, error: requestError } = await supabase
        .from("reimbursement_requests")
        .insert({
          user_id: user.id,
          total_amount: totalAmount,
          status: "pending",
          notes: collectionTitle
            ? `Care Event: ${collectionTitle}${notes ? `\n${notes}` : ""}`
            : notes || null,
          hsa_provider: hsaProvider || null,
          submission_method: "manual",
          submitted_at: new Date().toISOString(),
          ...(collectionId ? { collection_id: collectionId } : {}),
        })
        .select("id")
        .single();

      if (requestError) throw requestError;

      // Create reimbursement items
      const items = entries.map((e) => ({
        reimbursement_request_id: request.id,
        invoice_id: e.invoice_id,
      }));

      const { error: itemsError } = await supabase
        .from("reimbursement_items")
        .insert(items);

      if (itemsError) throw itemsError;

      // Mark invoices as reimbursed
      const invoiceIds = entries.map((e) => e.invoice_id);
      const { error: updateError } = await supabase
        .from("invoices")
        // Workstream B: is_reimbursed is derived from claim_state.
        .update({ claim_state: "reimbursed" })
        .in("id", invoiceIds);

      if (updateError) throw updateError;

      // Download PDF
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HSA-Claim-${collectionTitle ? collectionTitle.replace(/[^a-zA-Z0-9]/g, "-") : new Date().toISOString().split("T")[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      return request;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });
      queryClient.invalidateQueries({ queryKey: ["claimable-care-events"] });
      queryClient.invalidateQueries({ queryKey: ["reimbursement-requests"] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (collectionId) {
        queryClient.invalidateQueries({
          queryKey: ["collection", collectionId],
        });
        queryClient.invalidateQueries({
          queryKey: ["collection-invoices", collectionId],
        });
      }
      toast.success(
        `HSA claim created for $${totalAmount.toFixed(2)} — PDF downloaded`,
      );
      setHsaProvider("");
      setNotes("");
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      logError("Failed to create HSA claim", error);
      toast.error("Failed to create HSA claim");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-purple-600" />
            Claim HSA Reimbursement
          </DialogTitle>
          <DialogDescription>
            {collectionTitle
              ? `Create an HSA claim for "${collectionTitle}" — ${entries.length} eligible bill${entries.length !== 1 ? "s" : ""}.`
              : `Create an HSA claim for ${entries.length} selected bill${entries.length !== 1 ? "s" : ""}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary of entries */}
          <div className="bg-purple-500/5 rounded-lg p-3 border border-purple-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {entries.length} bill{entries.length !== 1 ? "s" : ""}
              </span>
              <span className="text-sm font-semibold text-purple-600">
                ${totalAmount.toFixed(2)} total
              </span>
            </div>
            <ScrollArea className="max-h-[150px]">
              <div className="space-y-1">
                {entries.map((entry) => (
                  <div
                    key={entry.invoice_id}
                    className="flex items-center justify-between text-sm py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{entry.vendor}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(entry.service_date), "MMM d")}
                      </span>
                    </div>
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <DollarSign className="h-3 w-3" />
                      {entry.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* HSA Provider */}
          <div className="space-y-2">
            <Label htmlFor="claim-hsa-provider">HSA Provider</Label>
            <Select value={hsaProvider} onValueChange={setHsaProvider}>
              <SelectTrigger id="claim-hsa-provider">
                <SelectValue placeholder="Select your HSA provider" />
              </SelectTrigger>
              <SelectContent>
                {HSA_PROVIDERS.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Adds provider-specific instructions to the PDF
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="claim-notes">Notes (Optional)</Label>
            <Textarea
              id="claim-notes"
              placeholder="Add any notes for this claim..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* What happens next */}
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What happens next:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>
                A PDF reimbursement package will be generated and downloaded
              </li>
              <li>These bills will be marked as reimbursed in your ledger</li>
              <li>
                Upload the PDF to your HSA provider's portal to complete the
                claim
              </li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending || entries.length === 0}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {claimMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Create Claim & Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
