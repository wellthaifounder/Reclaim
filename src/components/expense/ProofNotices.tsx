// What needs attention beside Documents (SUBSTANTIATE_SPEC S23, S26, S27, S34).
//
// Two things live here and nothing else:
//
//   * IRS-category problems -- Publication 502 says the expense is not allowed,
//     or allowed only with a letter of medical necessity. They sit beside the
//     documents because documents are what fix the second kind, and because the
//     category check reads what the documents say was bought.
//   * The amber label: "Needs a receipt or itemised bill", shown until
//     something is attached, with "What counts?" opening the short list of what
//     proof should show. That list is the ONE place the IRS explanation lives;
//     it used to be told three times (a grey note, a "Still to add" box, and a
//     "What the IRS would want to see" box). "I don't have one" sits beside
//     it (S34): the receipt is lost, so stop asking. The label becomes a plain
//     statement of what backs the expense, with Undo -- and attaching a document
//     later clears it by itself.
//
// A check that passes says nothing (S23). "Proper proof" is, for now, any
// attached document; telling a bare card slip from an itemised receipt needs
// what the scan reads, which arrives with the scan (S28).
//
// Used by the dialog and by the full expense page, which both render it so the
// two cannot drift apart (S35).

import { useState } from "react";
import { FileWarning, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExpenseDecision } from "@/hooks/useExpenseDecision";
import {
  useClassifyExpense,
  useEligibilityGates,
} from "@/hooks/useEligibilityGates";

interface ProofNoticesProps {
  invoiceId: string;
  hasDocuments: boolean;
  /** A mileage log is its own proof -- there is no receipt to chase (S17). */
  isMileage?: boolean;
  /** The person said there is no receipt (documentation_state not_available). */
  noReceipt?: boolean;
  /** Where "Add one" should take the person, when the attach options are not
   *  already on screen beside this label. */
  onAddDocument?: () => void;
}

const WHAT_COUNTS = [
  "The patient",
  "The provider",
  "The date of care",
  "What was done or bought",
  "What it cost",
];

export function ProofNotices({
  invoiceId,
  hasDocuments,
  isMileage = false,
  noReceipt = false,
  onAddDocument,
}: ProofNoticesProps) {
  const { pub502 } = useEligibilityGates(invoiceId);
  const classify = useClassifyExpense();
  const { setNoReceipt } = useExpenseDecision();
  const [showWhatCounts, setShowWhatCounts] = useState(false);

  const needsProof = !hasDocuments && !isMileage && !noReceipt;
  const declaredNone = !hasDocuments && !isMileage && noReceipt;

  return (
    <div className="space-y-2">
      {pub502?.status === "ineligible" && (
        <p className="text-sm text-destructive">{pub502.reason}</p>
      )}

      {pub502?.status === "conditional" && (
        <div className="space-y-1 text-sm">
          <p>{pub502.reason}</p>
          {pub502.action_prompt && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              {pub502.action_prompt}
            </p>
          )}
        </div>
      )}

      {/* Still a button until the category check runs by itself after each
          scan (S24); until then it is the only way to ask. */}
      {pub502?.status === "unknown" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => classify.mutate(invoiceId)}
          disabled={classify.isPending}
        >
          {classify.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Work out if this qualifies
        </Button>
      )}

      {needsProof && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-500">
              <FileWarning className="h-4 w-4 shrink-0" aria-hidden="true" />
              Needs a receipt or itemised bill
            </p>
            <button
              type="button"
              className="text-sm underline underline-offset-2 hover:opacity-80"
              aria-expanded={showWhatCounts}
              onClick={() => setShowWhatCounts((v) => !v)}
            >
              What counts?
            </button>
            <button
              type="button"
              className="text-sm underline underline-offset-2 hover:opacity-80"
              onClick={() => void setNoReceipt(invoiceId, true)}
            >
              I don&rsquo;t have one
            </button>
            {onAddDocument && (
              <button
                type="button"
                className="text-sm underline underline-offset-2 hover:opacity-80"
                onClick={onAddDocument}
              >
                Add one
              </button>
            )}
          </div>
          {showWhatCounts && (
            <div className="mt-2 space-y-1 text-sm">
              <p>A receipt or itemised bill should show:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {WHAT_COUNTS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                A card statement on its own usually isn&rsquo;t enough.
              </p>
            </div>
          )}
        </div>
      )}

      {declaredNone && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm">
          No receipt, bank record only.
          <button
            type="button"
            className="underline underline-offset-2 hover:opacity-80"
            onClick={() => void setNoReceipt(invoiceId, false)}
          >
            Undo
          </button>
        </p>
      )}
    </div>
  );
}
