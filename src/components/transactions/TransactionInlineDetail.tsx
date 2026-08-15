import { useState } from "react";
import { logError } from "@/utils/errorHandler";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Save,
  X,
  FileText,
  DollarSign,
  Calendar,
  Tag,
  Link as LinkIcon,
} from "lucide-react";

interface TransactionInlineDetailProps {
  transaction: {
    id: string;
    transaction_date: string;
    vendor: string | null;
    amount: number;
    description: string;
    category: string | null;
    is_medical: boolean | null;
    is_hsa_eligible: boolean | null;
    notes: string | null;
    reconciliation_status: string | null;
    payment_method_id: string | null;
    invoice_id: string | null;
    payment_methods?: {
      is_hsa_account: boolean;
    } | null;
  };
  onClose: () => void;
  onUpdate: () => void;
}

export function TransactionInlineDetail({
  transaction,
  onClose,
  onUpdate,
}: TransactionInlineDetailProps) {
  const [notes, setNotes] = useState(transaction.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSaveNotes = async () => {
    try {
      setSaving(true);
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
          is_hsa_eligible: !transaction.is_medical,
          reconciliation_status: !transaction.is_medical
            ? "linked"
            : "unlinked",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success(
        transaction.is_medical
          ? "Unmarked as medical"
          : "Marked as medical expense",
      );
      onUpdate();
    } catch (error) {
      logError("Error toggling medical status", error);
      toast.error("Failed to update status");
    }
  };

  const handleIgnore = async () => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          reconciliation_status: "ignored",
          is_medical: false,
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Transaction ignored");
      onUpdate();
      onClose();
    } catch (error) {
      logError("Error ignoring transaction", error);
      toast.error("Failed to ignore transaction");
    }
  };

  return (
    <Card className="p-6 border-t-2 border-primary/20 bg-muted/30">
      <div className="space-y-6">
        {/* Header with close button */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Transaction Details</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {transaction.vendor || "Unknown Vendor"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Date</span>
            </div>
            <p className="font-medium">
              {format(new Date(transaction.transaction_date), "MMM d, yyyy")}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span>Amount</span>
            </div>
            <p className="font-medium text-lg">
              ${Math.abs(transaction.amount).toFixed(2)}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Tag className="h-4 w-4" />
              <span>Category</span>
            </div>
            <p className="font-medium capitalize">{transaction.category}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Status</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={
                  transaction.reconciliation_status === "linked"
                    ? "default"
                    : transaction.reconciliation_status === "ignored"
                      ? "secondary"
                      : "outline"
                }
              >
                {transaction.reconciliation_status}
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
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>Description</span>
          </div>
          <p className="text-sm">{transaction.description}</p>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this transaction..."
            rows={3}
          />
          <Button
            onClick={handleSaveNotes}
            disabled={saving || notes === (transaction.notes || "")}
            size="sm"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Notes"}
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-4 border-t">
          <Button
            onClick={handleToggleMedical}
            variant={transaction.is_medical ? "outline" : "default"}
          >
            {transaction.is_medical ? "Unmark Medical" : "Mark as Medical"}
          </Button>

          {transaction.reconciliation_status !== "ignored" && (
            <Button onClick={handleIgnore} variant="ghost">
              Ignore Transaction
            </Button>
          )}

          {transaction.is_medical && !transaction.invoice_id && (
            <Button variant="outline" className="ml-auto">
              <LinkIcon className="h-4 w-4 mr-2" />
              Link to Invoice
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
