// Spec D35's "tap for detail" target.
//
// Deliberately NOT TransactionInlineDetail (the "All transactions" tab's
// detail panel). That component writes is_medical/reconciliation_status
// straight to the table, bypassing decide_transactions entirely -- which
// means no provenance stamp, no expense-creation trigger, no rule offer
// (D17-D19), no receipt-offer toast. It also has no Split action and needs
// several fields (notes, applied_by_rule_id, plaid_accounts...) this queue's
// data never fetches. Reusing it as-is would have been a real behavior
// regression dressed up as a component reuse. This is a small purpose-built
// panel instead, wired to the exact same onConfirm/onDismiss/onSplit
// callbacks GroupRow's own buttons already call -- so a decision made from
// here is indistinguishable, end to end, from one made by tapping a button.

import { CheckCircle2, XCircle, Split, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { formatFeedDate } from "@/components/transactions/reviewFeedDates";

interface ReviewRowDetailProps {
  vendor: string;
  date: string;
  amount: number;
  category?: string | null;
  explanation?: string | null;
  /** Omitted exactly when the row's own Healthcare button is also omitted
   *  (the OTC lane's solo row) -- no special-casing beyond what already
   *  governs the buttons. */
  onConfirm?: () => void;
  onDismiss: () => void;
  onSplit: () => void;
  onClose: () => void;
  busy: boolean;
}

export function ReviewRowDetail({
  vendor,
  date,
  amount,
  category,
  explanation,
  onConfirm,
  onDismiss,
  onSplit,
  onClose,
  busy,
}: ReviewRowDetailProps) {
  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{vendor}</p>
          <p className="text-xs text-muted-foreground">
            {formatFeedDate(date, "MMM d, yyyy")} &middot;{" "}
            <Money value={amount} />
            {category ? ` · ${category}` : ""}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close details</span>
        </Button>
      </div>

      {explanation && (
        <p className="text-xs text-muted-foreground">{explanation}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onConfirm && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onConfirm}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Healthcare
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
          <XCircle className="mr-1 h-4 w-4" />
          Not healthcare
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onSplit}>
          <Split className="mr-1 h-4 w-4" />
          Split
        </Button>
      </div>
    </div>
  );
}
