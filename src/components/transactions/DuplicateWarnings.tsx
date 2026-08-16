// Workstream C6 — the duplicate warning surface.
//
// Two expense records for one real charge, side by side, with the two things
// the user can honestly do about it: keep one, or say they are different.
//
// Deliberately NOT a toast or a banner count. The decision needs both records
// visible — which one has the receipt, which one has the amount the bank
// actually saw — because picking blind is how a user deletes the wrong record
// and loses documentation they cannot recreate.

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, FileText, Landmark, PencilLine, Check } from "lucide-react";
import { format } from "date-fns";
import {
  useDuplicateCandidates,
  explainDuplicate,
  suggestedKeeper,
  type DuplicateCandidate,
  type DuplicateExpenseSide,
} from "@/hooks/useDuplicateCandidates";

function SideCard({
  side,
  isSuggested,
  isChosen,
  onChoose,
  disabled,
}: {
  side: DuplicateExpenseSide;
  isSuggested: boolean;
  isChosen: boolean;
  onChoose: () => void;
  disabled: boolean;
}) {
  const fromBank = !!side.source_plaid_transaction_id;

  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-pressed={isChosen}
      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
        isChosen
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <div className="mb-1 flex items-center gap-2">
        {fromBank ? (
          <Landmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <PencilLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground">
          {fromBank ? "From your bank" : "You added this"}
        </span>
        {isSuggested && (
          <Badge variant="secondary" className="ml-auto text-[10px]">
            Suggested
          </Badge>
        )}
        {isChosen && (
          <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
        )}
      </div>

      <p className="truncate font-medium text-foreground">{side.vendor}</p>
      <p className="text-lg font-semibold text-foreground">
        ${side.amount.toFixed(2)}
      </p>
      <p className="text-sm text-muted-foreground">
        {format(new Date(side.date), "MMM d, yyyy")}
        {side.patient_name ? ` · ${side.patient_name}` : ""}
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        {side.receipt_count > 0 ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <FileText className="h-3 w-3" />
            {side.receipt_count} document{side.receipt_count === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
          >
            No documents
          </Badge>
        )}
      </div>
    </button>
  );
}

function CandidateRow({
  candidate,
  onMerge,
  onDismiss,
  busy,
}: {
  candidate: DuplicateCandidate;
  onMerge: (keepId: string) => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const suggested = suggestedKeeper(candidate);
  const [keepId, setKeepId] = useState<string>(suggested.id);
  const other = keepId === candidate.a.id ? candidate.b : candidate.a;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start gap-2">
        <Copy
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {explainDuplicate(candidate)}
          </p>
          {/* Only shown for the ambiguous reason, where the user genuinely
              needs to weigh it. Putting a confidence number on every row
              invites treating the high-confidence ones as settled. */}
          {candidate.match_reason === "same_charge" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Two visits on the same day can look exactly like this.
            </p>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SideCard
          side={candidate.a}
          isSuggested={suggested.id === candidate.a.id}
          isChosen={keepId === candidate.a.id}
          onChoose={() => setKeepId(candidate.a.id)}
          disabled={busy}
        />
        <SideCard
          side={candidate.b}
          isSuggested={suggested.id === candidate.b.id}
          isChosen={keepId === candidate.b.id}
          onChoose={() => setKeepId(candidate.b.id)}
          disabled={busy}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onMerge(keepId)} disabled={busy}>
          Keep the selected one
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss} disabled={busy}>
          These are different
        </Button>
      </div>

      {/* Says plainly that nothing is thrown away, because the button label
          alone reads like a delete and users hesitate over it. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {other.receipt_count > 0
          ? `The ${other.receipt_count} document${
              other.receipt_count === 1 ? "" : "s"
            } on the other record will move across, not be deleted.`
          : "Any documents on the other record move across, not deleted."}
      </p>
    </Card>
  );
}

export function DuplicateWarnings() {
  const { candidates, isLoading, merge, dismiss, runDetection } =
    useDuplicateCandidates();
  const busy = merge.isPending || dismiss.isPending;

  // Re-scan once when the review surface opens. Expenses are created by
  // several paths — the upload wizards, splitting — that do not run detection
  // themselves, and a warning that first appears after the next bank sync
  // arrives too late to stop a duplicate being claimed.
  const scanned = useRef(false);
  useEffect(() => {
    if (scanned.current) return;
    scanned.current = true;
    runDetection.mutate();
    // runDetection is a stable mutation object; the ref guard is what keeps
    // this to one scan per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading || candidates.length === 0) return null;

  return (
    <div className="space-y-3">
      <Alert>
        <Copy className="h-4 w-4" />
        <AlertDescription>
          <strong>
            {candidates.length} possible duplicate
            {candidates.length === 1 ? "" : "s"}.
          </strong>{" "}
          The same expense recorded twice can be claimed twice by accident,
          which is the kind of mistake an HSA audit looks for. Worth a minute
          now.
        </AlertDescription>
      </Alert>

      {candidates.map((c) => (
        <CandidateRow
          key={c.id}
          candidate={c}
          busy={busy}
          onMerge={(keepId) => merge.mutate({ candidateId: c.id, keepId })}
          onDismiss={() => dismiss.mutate(c.id)}
        />
      ))}
    </div>
  );
}
