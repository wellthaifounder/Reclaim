import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import { useTransactionSplits } from "@/hooks/useTransactionSplits";
import {
  validateSplitAmounts,
  calculateRemainingAmount,
} from "@/lib/transactionSplitUtils";
import { HSAAccountSelector } from "@/components/hsa/HSAAccountSelector";
import type { Database } from "@/integrations/supabase/types";

type Transaction = Database["public"]["Tables"]["transactions"]["Row"];

const splitFormSchema = z.object({
  splits: z
    .array(
      z.object({
        hsa_account_id: z.string().nullable(),
        amount: z.number().positive("Amount must be positive"),
        description: z.string().min(1, "Description is required"),
        notes: z.string().optional(),
      }),
    )
    .min(1, "At least one split is required"),
});

type SplitFormValues = z.infer<typeof splitFormSchema>;

interface TransactionSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction;
}

export function TransactionSplitDialog({
  open,
  onOpenChange,
  transaction,
}: TransactionSplitDialogProps) {
  const { createSplits } = useTransactionSplits(transaction.id);
  const [validationError, setValidationError] = useState<string | null>(null);

  const form = useForm<SplitFormValues>({
    resolver: zodResolver(splitFormSchema),
    defaultValues: {
      splits: [
        {
          hsa_account_id: null,
          amount: transaction.amount,
          description: transaction.description || "Split 1",
          notes: "",
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "splits",
  });

  const watchedSplits = form.watch("splits");
  const validSplits = watchedSplits.map((s) => ({
    hsa_account_id: s.hsa_account_id || null,
    amount: s.amount || 0,
    description: s.description || "",
    notes: s.notes,
  }));
  const remaining = calculateRemainingAmount(validSplits, transaction.amount);

  const handleAddSplit = () => {
    const remainingAmount = calculateRemainingAmount(
      validSplits,
      transaction.amount,
    );
    append({
      hsa_account_id: null,
      amount: remainingAmount,
      description: `Split ${fields.length + 1}`,
      notes: "",
    });
  };

  const handleSubmit = form.handleSubmit((data) => {
    const splits = data.splits.map((s) => ({
      hsa_account_id: s.hsa_account_id || null,
      amount: s.amount,
      description: s.description,
      notes: s.notes,
    }));
    const validation = validateSplitAmounts(splits, transaction.amount);

    if (!validation.isValid) {
      setValidationError(validation.message || "Invalid split amounts");
      return;
    }

    setValidationError(null);
    createSplits.mutate(
      {
        transactionId: transaction.id,
        splits,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          form.reset();
        },
      },
    );
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Split Transaction</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Divide this transaction across multiple HSA accounts or categories.
          Total amount: {formatCurrency(transaction.amount)}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 px-4 pb-4 overflow-y-auto"
      >
        <div className="space-y-4">
          {fields.map((field, index) => (
            <div key={field.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">
                  Split {index + 1}
                </Label>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div>
                <Label htmlFor={`splits.${index}.hsa_account_id`}>
                  HSA Account
                </Label>
                <HSAAccountSelector
                  value={
                    form.watch(`splits.${index}.hsa_account_id`) || undefined
                  }
                  onValueChange={(value) =>
                    form.setValue(
                      `splits.${index}.hsa_account_id`,
                      value === "none" ? null : value,
                    )
                  }
                  includeNone
                />
              </div>

              <div>
                <Label htmlFor={`splits.${index}.amount`}>Amount</Label>
                <Input
                  id={`splits.${index}.amount`}
                  type="number"
                  step="0.01"
                  {...form.register(`splits.${index}.amount`, {
                    valueAsNumber: true,
                  })}
                />
                {form.formState.errors.splits?.[index]?.amount && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.splits[index]?.amount?.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor={`splits.${index}.description`}>
                  Description
                </Label>
                <Input
                  id={`splits.${index}.description`}
                  {...form.register(`splits.${index}.description`)}
                />
                {form.formState.errors.splits?.[index]?.description && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.splits[index]?.description?.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor={`splits.${index}.notes`}>
                  Notes (Optional)
                </Label>
                <Textarea
                  id={`splits.${index}.notes`}
                  {...form.register(`splits.${index}.notes`)}
                  rows={2}
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleAddSplit}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Split
        </Button>

        <div className="bg-muted p-3 rounded-lg">
          <div className="flex justify-between text-sm">
            <span>Total Transaction:</span>
            <Money value={transaction.amount} className="font-semibold" />
          </div>
          <div className="flex justify-between text-sm">
            <span>Total Allocated:</span>
            <Money
              value={transaction.amount - remaining}
              className="font-semibold"
            />
          </div>
          <div className="flex justify-between text-sm">
            <span>Remaining:</span>
            <Money
              value={remaining}
              className={`font-semibold ${remaining > 0 ? "text-destructive" : "text-success"}`}
            />
          </div>
        </div>

        {validationError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createSplits.isPending}>
            {createSplits.isPending ? "Splitting..." : "Split Transaction"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  );
}
