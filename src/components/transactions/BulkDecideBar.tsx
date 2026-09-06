import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, X, Loader2 } from "lucide-react";

interface BulkDecideBarProps {
  visible: boolean;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  onToggleAll: (next: boolean) => void;
  onDecide: (isMedical: boolean) => void;
  onClear: () => void;
}

/**
 * Select-all plus the two decisions, for the whole ticked set at once.
 *
 * Always rendered above the list rather than appearing only once something is
 * ticked: a bar that materialises on first selection shifts every row down by
 * its own height at the exact moment the user is aiming at a checkbox.
 */
export function BulkDecideBar({
  visible,
  selectedCount,
  allSelected,
  busy,
  onToggleAll,
  onDecide,
  onClear,
}: BulkDecideBarProps) {
  if (!visible) return null;
  const active = selectedCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <Checkbox
        checked={allSelected}
        onCheckedChange={(v) => onToggleAll(v === true)}
        aria-label="Select all transactions"
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
            onClick={() => onDecide(true)}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            Medical
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            <X className="h-4 w-4 mr-1" aria-hidden="true" />
            Not medical
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
