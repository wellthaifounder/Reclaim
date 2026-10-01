// The decision, in the footer of the Substantiate dialog and on the full expense
// page (SUBSTANTIATE_SPEC S30-S33, S35).
//
// Confirm eligible is the main button and Not eligible sits beside it. Closing
// without deciding keeps everything entered and leaves the expense in the queue.
//
//   * S32 -- when the IRS list says a category is not allowed, Confirm is still
//     there, behind one extra step: "Confirm anyway?". That is judgement, and
//     the person is the approver. The record notes it was their call.
//   * S33 -- when a FACT refuses it (care before the HSA opened, a patient who
//     is not a tax dependent), Confirm is not offered at all until the date or
//     the family list is corrected. The problem is already shown beside its
//     field by SubstantiationPanel.
//   * An expense already inside a request, or reimbursed, is settled: nothing
//     here would change it, so nothing is offered.

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEligibilityGates } from "@/hooks/useEligibilityGates";
import {
  CONFIRM_ANYWAY_PROMPT,
  refusedByFact,
  useExpenseDecision,
} from "@/hooks/useExpenseDecision";

interface ExpenseDecisionProps {
  invoiceId: string;
  eligibilityState: string | null;
  claimState: string | null;
  /** Called after a decision is saved. */
  onDecided?: (decision: "eligible" | "ineligible") => void;
  /** Working through the queue: "3 of 12", and a way past one without deciding. */
  position?: { current: number; total: number };
  onSkip?: () => void;
}

export function ExpenseDecision({
  invoiceId,
  eligibilityState,
  claimState,
  onDecided,
  position,
  onSkip,
}: ExpenseDecisionProps) {
  const { gates, isLoading } = useEligibilityGates(invoiceId);
  const { decide, pending } = useExpenseDecision();
  const [askingAnyway, setAskingAnyway] = useState(false);

  const settled =
    claimState != null &&
    claimState !== "unclaimed" &&
    claimState !== "not_reimbursable";
  if (settled) return null;

  const confirmed = eligibilityState === "eligible";
  const markedNot = eligibilityState === "ineligible";
  const factRefuses = refusedByFact(gates);

  const run = async (
    decision: "eligible" | "ineligible",
    acknowledgedList = false,
  ) => {
    const outcome = await decide(invoiceId, decision, { acknowledgedList });
    if (outcome === "needs_override") setAskingAnyway(true);
    if (outcome === "done") {
      setAskingAnyway(false);
      onDecided?.(decision);
    }
  };

  const count = position && (
    <p className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground sm:mr-auto">
      {position.current} of {position.total}
    </p>
  );

  if (askingAnyway) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {count}
        <p className="text-sm sm:max-w-sm">{CONFIRM_ANYWAY_PROMPT}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setAskingAnyway(false)}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void run("eligible", true)}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Confirm anyway
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {count}
      {onSkip && (
        <Button variant="ghost" disabled={pending} onClick={onSkip}>
          Skip
        </Button>
      )}
      <Button
        variant="outline"
        disabled={pending || markedNot}
        onClick={() => void run("ineligible")}
      >
        <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
        {markedNot ? "Marked not eligible" : "Not eligible"}
      </Button>
      {!factRefuses && (
        <Button
          disabled={pending || isLoading || confirmed}
          onClick={() => void run("eligible")}
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {confirmed ? "Confirmed eligible" : "Confirm eligible"}
        </Button>
      )}
    </div>
  );
}
