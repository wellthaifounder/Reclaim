import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QuickAddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function QuickAddTransactionDialog({
  open,
  onOpenChange,
  onSuccess,
}: QuickAddTransactionDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    transaction_date: new Date().toISOString().split("T")[0],
    vendor: "",
    amount: "",
    description: "",
    is_medical: false,
    notes: "",
  });

  const addTransaction = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("transactions").insert({
        user_id: user.id,
        transaction_date: formData.transaction_date,
        vendor: formData.vendor,
        amount: parseFloat(formData.amount),
        description: formData.description || formData.vendor,
        is_medical: formData.is_medical,
        is_hsa_eligible: formData.is_medical,
        category: formData.is_medical ? "medical" : "uncategorized",
        notes: formData.notes || null,
        source: "manual",
        reconciliation_status: "unlinked",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transaction added successfully");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onSuccess();
      onOpenChange(false);
      setFormData({
        transaction_date: new Date().toISOString().split("T")[0],
        vendor: "",
        amount: "",
        description: "",
        is_medical: false,
        notes: "",
      });
    },
    onError: () => toast.error("Failed to add transaction"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addTransaction.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* "Transaction" is the internal name for the row this writes. To
              the person filling the form it is a purchase their bank did not
              import -- cash, a cheque, an account they have not connected --
              so the label says that instead. */}
          <DialogTitle>Add a spend your bank missed</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={formData.transaction_date}
              onChange={(e) =>
                setFormData({ ...formData, transaction_date: e.target.value })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="vendor">Vendor</Label>
            <Input
              id="vendor"
              value={formData.vendor}
              onChange={(e) =>
                setFormData({ ...formData, vendor: e.target.value })
              }
              placeholder="e.g., CVS Pharmacy"
              required
            />
          </div>

          <div>
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) =>
                setFormData({ ...formData, amount: e.target.value })
              }
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Transaction details"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="is-medical">Medical Expense</Label>
            <Switch
              id="is-medical"
              checked={formData.is_medical}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_medical: checked })
              }
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              placeholder="Add any additional notes..."
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="submit"
              disabled={addTransaction.isPending}
              className="flex-1"
            >
              {addTransaction.isPending ? "Adding..." : "Add Transaction"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
