import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Link2, FileText } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

interface TransactionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    transaction_date: string;
    vendor: string | null;
    amount: number;
    description: string;
    category: string;
    is_medical: boolean;
    reconciliation_status: string;
    is_hsa_eligible: boolean;
    notes: string | null;
    payment_method_id: string | null;
    invoice_id: string | null;
    payment_methods?: {
      is_hsa_account: boolean;
    } | null;
  } | null;
  onUpdate: () => void;
  onLinkToInvoice: () => void;
}

export function TransactionDetailDialog({
  open,
  onOpenChange,
  transaction,
  onUpdate,
  onLinkToInvoice,
}: TransactionDetailDialogProps) {
  const [notes, setNotes] = useState(transaction?.notes || "");
  const [saving, setSaving] = useState(false);

  if (!transaction) return null;

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("transactions")
        .update({ notes })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Notes saved");
      onUpdate();
    } catch (error) {
      logError("Error saving notes", error);
      toast.error("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMedical = async () => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: !transaction.is_medical,
          is_hsa_eligible: !transaction.is_medical, // Auto-mark as HSA eligible if medical
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success(
        transaction.is_medical ? "Unmarked as medical" : "Marked as medical",
      );
      onUpdate();
    } catch (error) {
      logError("Error updating transaction", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleIgnore = async () => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({ reconciliation_status: "ignored" })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Transaction ignored");
      onUpdate();
      onOpenChange(false);
    } catch (error) {
      logError("Error ignoring transaction", error);
      toast.error("Failed to ignore transaction");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transaction Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">Date</Label>
              <p className="text-base font-medium">
                {format(new Date(transaction.transaction_date), "MMMM d, yyyy")}
              </p>
            </div>

            <div>
              <Label className="text-sm text-muted-foreground">Amount</Label>
              <p className="text-2xl font-bold text-foreground">
                ${Math.abs(transaction.amount).toFixed(2)}
              </p>
            </div>
          </div>

          <div>
            <Label className="text-sm text-muted-foreground">Vendor</Label>
            <p className="text-base font-medium">
              {transaction.vendor || "Not specified"}
            </p>
          </div>

          <div>
            <Label className="text-sm text-muted-foreground">Description</Label>
            <p className="text-sm">{transaction.description}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={transaction.is_medical ? "default" : "outline"}>
              {transaction.is_medical ? "Medical" : "Non-Medical"}
            </Badge>
            {transaction.payment_methods?.is_hsa_account && (
              <Badge variant="success">Paid via HSA</Badge>
            )}
            {transaction.is_hsa_eligible &&
              !transaction.payment_methods?.is_hsa_account && (
                <Badge className="bg-primary/10 text-primary">
                  HSA Eligible
                </Badge>
              )}
            <Badge variant="secondary">{transaction.category}</Badge>
            {transaction.reconciliation_status === "linked_to_invoice" && (
              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">
                Linked to Bill
              </Badge>
            )}
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this transaction..."
              className="mt-2"
              rows={3}
            />
            <Button
              onClick={handleSaveNotes}
              disabled={saving || notes === transaction.notes}
              className="mt-2"
              size="sm"
            >
              {saving ? "Saving..." : "Save Notes"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 pt-4 border-t">
            <Button onClick={handleToggleMedical} variant="outline">
              <FileText className="mr-2 h-4 w-4" />
              {transaction.is_medical ? "Unmark as Medical" : "Mark as Medical"}
            </Button>

            {transaction.reconciliation_status === "unlinked" && (
              <Button onClick={onLinkToInvoice} variant="outline">
                <Link2 className="mr-2 h-4 w-4" />
                Link to Bill
              </Button>
            )}

            {transaction.reconciliation_status === "unlinked" && (
              <Button onClick={handleIgnore} variant="ghost">
                Ignore Transaction
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
