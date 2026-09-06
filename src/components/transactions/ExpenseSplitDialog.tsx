import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertCircle, Split } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { toast } from "sonner";
import {
  formatUsd,
  splitEvenly,
  validateExpenseSplits,
  type ExpenseSplitDraft,
} from "@/lib/expenseSplitUtils";

interface SplittableTransaction {
  id: string;
  amount: number;
  vendor: string | null;
  description: string;
  transaction_date: string;
  category?: string | null;
}

interface ExpenseSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: SplittableTransaction;
  userId: string;
  onSplit?: () => void;
}

function blankRow(
  txn: SplittableTransaction,
  amount: number,
): ExpenseSplitDraft {
  return {
    amount,
    vendor: txn.vendor || txn.description || "",
    category: txn.category || "Medical",
    serviceDate: txn.transaction_date,
    patientName: "Self",
    notes: "",
  };
}

/**
 * Split one bank transaction into several expenses.
 *
 * Two cases this exists for:
 *   - A mixed basket: $87 at Walmart where only $12 was Tylenol. The remaining
 *     $75 stays unclaimed — expenses may total LESS than the transaction.
 *   - A bundled payment: $2,400 to a hospital covering three visits for two
 *     family members, possibly across two tax years.
 *
 * Distinct from TransactionSplitDialog, which splits across HSA accounts.
 */
export function ExpenseSplitDialog({
  open,
  onOpenChange,
  transaction,
  userId,
  onSplit,
}: ExpenseSplitDialogProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ExpenseSplitDraft[]>([
    blankRow(transaction, transaction.amount),
  ]);
  const [saving, setSaving] = useState(false);

  const validation = useMemo(
    () => validateExpenseSplits(rows, transaction.amount),
    [rows, transaction.amount],
  );

  const update = (i: number, patch: Partial<ExpenseSplitDraft>) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      blankRow(transaction, Math.max(0, validation.remainder)),
    ]);

  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const distributeEvenly = () => {
    const amounts = splitEvenly(transaction.amount, rows.length);
    setRows((prev) => prev.map((r, i) => ({ ...r, amount: amounts[i] })));
  };

  const handleSave = async () => {
    if (!validation.isValid) return;
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        user_id: userId,
        vendor: r.vendor.trim(),
        amount: r.amount,
        // Date of service, which the IRS ties the expense to — not the date
        // the payment cleared.
        date: r.serviceDate,
        category: r.category || "Medical",
        notes: r.notes.trim() || null,
        patient_name: r.patientName.trim() || null,
        amount_paid: r.amount,
        reimbursable_amount: r.amount,
        // Facets, not the derived columns. Eligibility is resolved during
        // substantiation, never here.
        eligibility_state: "unknown" as const,
        documentation_state: "none" as const,
        claim_state: "unclaimed" as const,
        source_transaction_id: transaction.id,
      }));

      const { data: created, error } = await supabase
        .from("invoices")
        .insert(payload)
        .select("id");
      if (error) throw error;

      // The transaction now has several expenses, so `invoice_id` (single
      // valued) can no longer represent the relationship — invoices.
      // source_transaction_id does. We still point it at the first expense so
      // existing single-link UI keeps working.
      const { error: txnErr } = await supabase
        .from("transactions")
        .update({
          is_medical: true,
          needs_review: false,
          reconciliation_status: "linked_to_invoice",
          invoice_id: created?.[0]?.id ?? null,
          is_split: true,
        })
        .eq("id", transaction.id);
      if (txnErr) throw txnErr;

      toast.success(
        rows.length === 1
          ? "Expense created."
          : `${rows.length} expenses created from this transaction.`,
      );
      // This transaction just went from needs_review to decided, from either
      // the "All transactions" list or the review feed's OTC lane -- neither
      // caller's own refresh touches the shared nav-badge query, so it has to
      // be invalidated here, at the one place both paths actually mutate.
      queryClient.invalidateQueries({ queryKey: ["attention-items"] });
      onSplit?.();
      onOpenChange(false);
    } catch (err) {
      logError("ExpenseSplitDialog.save", err);
      toast.error("Could not split this transaction. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle className="flex items-center gap-2">
          <Split className="h-4 w-4" aria-hidden="true" />
          Split into expenses
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {transaction.vendor || transaction.description} ·{" "}
          {formatUsd(transaction.amount)}. Only the medical part needs to become
          an expense — anything left over stays unclaimed.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <ResponsiveDialogBody className="space-y-4">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Expense {i + 1}</span>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove expense ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`amount-${i}`}>Amount</Label>
                <Input
                  id={`amount-${i}`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) =>
                    update(i, { amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`service-${i}`}>Date of service</Label>
                <Input
                  id={`service-${i}`}
                  type="date"
                  value={row.serviceDate}
                  onChange={(e) => update(i, { serviceDate: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`vendor-${i}`}>Provider</Label>
                <Input
                  id={`vendor-${i}`}
                  value={row.vendor}
                  onChange={(e) => update(i, { vendor: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`patient-${i}`}>Patient</Label>
                <Input
                  id={`patient-${i}`}
                  value={row.patientName}
                  onChange={(e) => update(i, { patientName: e.target.value })}
                  placeholder="Self, Spouse, or a name"
                />
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" />
            Add expense
          </Button>
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={distributeEvenly}
            >
              Split evenly
            </Button>
          )}
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span>Claimed as expenses</span>
            <span className="font-medium">
              {formatUsd(validation.allocated)}
            </span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Left unclaimed</span>
            <span>{formatUsd(validation.remainder)}</span>
          </div>
        </div>

        {validation.message && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validation.message}</AlertDescription>
          </Alert>
        )}
      </ResponsiveDialogBody>

      <ResponsiveDialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!validation.isValid || saving}>
          {saving
            ? "Creating…"
            : `Create ${rows.length} expense${rows.length === 1 ? "" : "s"}`}
        </Button>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
