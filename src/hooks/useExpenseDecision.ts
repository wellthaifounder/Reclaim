// The decision on one expense: Confirm eligible, Not eligible, and "I don't
// have one" (SUBSTANTIATE_SPEC S30-S34).
//
// One place for the writes, so the dialog, the full expense page and the queue
// row cannot drift apart on what a decision does.
//
//   * confirmed_at is the audit-trail moat: Medical Expense Records cite it as
//     the user's explicit determination, so it is stamped for a real decision
//     and never for a deferral.
//   * Writes go to the facets (eligibility_state, documentation_state), never
//     to lifecycle_status, which is derived and overwritten.
//   * Gates 1 and 2 are facts, gate 3 is judgement (S32, S33). The facts are
//     re-read at the moment of the click rather than trusted from what the
//     screen last fetched: recompute_expense_eligibility re-applies a factual
//     refusal even to a confirmed expense, so confirming past one would only
//     look like it worked.

import { useCallback, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import type { EligibilityGate } from "@/hooks/useEligibilityGates";

/** Gates 1 and 2 refuse on a fact. Nothing the person judges can overrule one. */
export function refusedByFact(gates: EligibilityGate[]): boolean {
  return gates.some(
    (g) => (g.gate === "timing" || g.gate === "dependency") && g.is_blocking,
  );
}

/** Gate 3: the IRS Publication 502 list says this category is not allowed. */
export function listSaysNotAllowed(gates: EligibilityGate[]): boolean {
  return gates.some((g) => g.gate === "pub502" && g.status === "ineligible");
}

export const CONFIRM_ANYWAY_PROMPT =
  "The IRS list says this usually isn't allowed. Confirm anyway?";

/**
 * What a decision can change, on every screen that shows an expense. Partial
 * keys reach the queue, the ledger and the dialog without any caller having to
 * know the others' keys.
 */
export function invalidateExpense(queryClient: QueryClient, invoiceId: string) {
  for (const key of [
    ["substantiate-expense"],
    ["substantiate-queue"],
    ["all-expenses"],
    ["bill", invoiceId],
    ["eligibility-gates", invoiceId],
    ["bills"],
    ["invoices"],
    ["attention-items"],
  ]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * done          -- saved.
 * needs_override -- the list says no; ask "Confirm anyway?" and call again
 *                  with acknowledgedList.
 * blocked       -- a fact refuses it (care before the HSA opened, a patient who
 *                  is not a tax dependent); nothing was saved.
 * failed        -- the save did not go through; the person has been told.
 */
export type DecisionOutcome = "done" | "needs_override" | "blocked" | "failed";

export function useExpenseDecision() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const decide = useCallback(
    async (
      invoiceId: string,
      decision: "eligible" | "ineligible",
      { acknowledgedList = false }: { acknowledgedList?: boolean } = {},
    ): Promise<DecisionOutcome> => {
      setPending(true);
      try {
        if (decision === "eligible") {
          const { data, error: gateError } = await supabase.rpc(
            "expense_eligibility_gates",
            { p_invoice_id: invoiceId },
          );
          if (gateError) throw gateError;
          const gates = (data ?? []) as EligibilityGate[];

          if (refusedByFact(gates)) {
            invalidateExpense(queryClient, invoiceId);
            toast.error(
              "That can't be confirmed until the date of care or the family list is corrected.",
            );
            return "blocked";
          }
          if (listSaysNotAllowed(gates) && !acknowledgedList) {
            return "needs_override";
          }
        }

        const { error } = await supabase
          .from("invoices")
          .update(
            decision === "eligible"
              ? {
                  eligibility_state: "eligible",
                  confirmed_at: new Date().toISOString(),
                  // An eligible expense carrying a refusal reason would
                  // contradict itself.
                  ineligible_reason: null,
                }
              : {
                  eligibility_state: "ineligible",
                  confirmed_at: new Date().toISOString(),
                },
          )
          .eq("id", invoiceId);
        if (error) throw error;

        invalidateExpense(queryClient, invoiceId);
        toast.success(
          decision === "eligible"
            ? "Confirmed eligible. Logged with timestamp."
            : "Marked not eligible.",
        );
        return "done";
      } catch (error) {
        logError("Saving the eligibility decision failed", error);
        toast.error("Could not save that decision. Please try again.");
        return "failed";
      } finally {
        setPending(false);
      }
    },
    [queryClient],
  );

  /**
   * "I don't have one" (S34). The guards on the update mean it can only ever
   * move between "none" and "not_available": a document attached in another
   * tab (state "complete") is never overwritten by a stale click.
   */
  const setNoReceipt = useCallback(
    async (invoiceId: string, declared: boolean): Promise<boolean> => {
      try {
        const { error } = await supabase
          .from("invoices")
          .update({
            documentation_state: declared ? "not_available" : "none",
          })
          .eq("id", invoiceId)
          .eq("documentation_state", declared ? "none" : "not_available");
        if (error) throw error;
        invalidateExpense(queryClient, invoiceId);
        return true;
      } catch (error) {
        logError("Saving 'no receipt' failed", error);
        toast.error("Couldn't save that. Please try again.");
        return false;
      }
    },
    [queryClient],
  );

  return { decide, setNoReceipt, pending };
}
