import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, XCircle, Paperclip, Loader2 } from "lucide-react";

interface Props {
  visible: boolean;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  onToggleAll: (next: boolean) => void;
  onConfirmEligible: () => void;
  onMarkIneligible: () => void;
  onAttachDocument: () => void;
  onClear: () => void;
}

/**
 * Select-all plus the three things worth doing to a whole set of expenses.
 *
 * "Attach a document" is here for one case in particular: a payment plan
 * billed across several months is several expenses and one treatment-plan
 * document, and pairing them one dialog at a time meant picking the same file
 * six times. Bulk *upload* deliberately isn't offered — separate expenses
 * normally need separate files, and the one-file-many-expenses case is the
 * exception that needs the help.
 *
 * Always rendered above the list rather than appearing on first selection,
 * matching BulkDecideBar: a bar that materialises later shifts every row down
 * by its own height at the moment the user is aiming at a checkbox.
 */
export function BulkSubstantiateBar({
  visible,
  selectedCount,
  allSelected,
  busy,
  onToggleAll,
  onConfirmEligible,
  onMarkIneligible,
  onAttachDocument,
  onClear,
}: Props) {
  if (!visible) return null;
  const active = selectedCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <Checkbox
        checked={allSelected}
        onCheckedChange={(v) => onToggleAll(v === true)}
        aria-label="Select all expenses"
      />
      <span className="text-sm text-muted-foreground">
        {active ? `${selectedCount} selected` : "Select all"}
      </span>

      {active && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={onConfirmEligible}
          >
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
            )}
            Confirm eligible
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={onMarkIneligible}
          >
            <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />
            Mark ineligible
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={onAttachDocument}
          >
            <Paperclip className="mr-1 h-4 w-4" aria-hidden="true" />
            Attach a document
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={busy}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
