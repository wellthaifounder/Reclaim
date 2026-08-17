// Workstream D3 — every eligibility gate for one expense, in one read.
//
// Gate 1 (timing) and Gate 2 (dependency) are independent questions with
// independent answers, and the user needs to see both: fixing the fixable one
// is pointless if the permanent one also refuses.
//
// These are reporters. `recompute_expense_eligibility` is the only thing that
// writes eligibility, and it evaluates both gates together — two independent
// writers each restored expenses the other was still refusing, which let a
// roster answer reopen a claim from before the HSA existed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

export type GateName = "timing" | "dependency" | "pub502";
export type GateStatus = "eligible" | "ineligible" | "conditional" | "unknown";

export interface EligibilityGate {
  gate: GateName;
  status: GateStatus;
  reason: string;
  is_blocking: boolean;
  /** True only for timing: nothing the user does can clear it. */
  is_permanent: boolean;
  /**
   * What to go and get. Populated only for a conditional Pub 502 rule that
   * has no letter of medical necessity attached yet.
   */
  action_prompt: string | null;
}

export function useEligibilityGates(invoiceId: string | null) {
  const query = useQuery({
    queryKey: ["eligibility-gates", invoiceId],
    enabled: !!invoiceId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<EligibilityGate[]> => {
      const { data, error } = await supabase.rpc("expense_eligibility_gates", {
        p_invoice_id: invoiceId!,
      });
      if (error) throw error;
      return (data ?? []) as EligibilityGate[];
    },
  });

  const gates = query.data ?? [];
  const blocking = gates.filter((g) => g.is_blocking);

  return {
    gates,
    blocking,
    /**
     * The one to lead with. A permanent refusal outranks a fixable one:
     * telling someone to go answer a tax question that will not help is worse
     * than telling them no.
     */
    primaryBlocker: blocking.find((g) => g.is_permanent) ?? blocking[0] ?? null,
    /** Gates still awaiting an answer — not refusals, just undetermined. */
    unresolved: gates.filter((g) => g.status === "unknown"),
    /**
     * Claimable once the user supplies something. Kept separate from
     * `blocking` on purpose: "go and get this letter" and "this can never be
     * claimed" are different messages and must not be shown the same way.
     */
    conditional: gates.filter((g) => g.status === "conditional"),
    pub502: gates.find((g) => g.gate === "pub502") ?? null,
    isLoading: query.isLoading,
  };
}

/**
 * Work out what kind of expense this is under Pub 502 — Gate 3.
 *
 * Workstream D4 moved this off the capture path. It used to fire the moment an
 * expense was saved, when the only evidence was a vendor string and a category
 * the user picked from a dropdown; the date of service, the patient and the
 * documents all arrive later. Running it during substantiation means the
 * answer rests on the evidence that actually decides it.
 *
 * A database trigger re-runs the gates when the rule changes, so the verdict
 * follows automatically.
 */
export function useClassifyExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.functions.invoke("classify-expense", {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
    },
    onSuccess: (_data, invoiceId) => {
      queryClient.invalidateQueries({
        queryKey: ["eligibility-gates", invoiceId],
      });
      queryClient.invalidateQueries({ queryKey: ["bill", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error) => logError("Classifying expense failed", error),
  });
}

/**
 * Re-evaluate every gate across the user's expenses.
 *
 * Both gates in one pass, deliberately. Two independent recomputes could each
 * restore what the other refuses.
 */
export function useRecomputeEligibility() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{ blocked: number; restored: number }> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in.");

      const { data, error } = await supabase.rpc(
        "recompute_expense_eligibility",
        { p_user_id: user.id, p_invoice_ids: undefined },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        blocked: Number(row?.blocked ?? 0),
        restored: Number(row?.restored ?? 0),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eligibility-gates"] });
      queryClient.invalidateQueries({ queryKey: ["timing-gate"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["claimable-events"] });
    },
    onError: (error) => logError("Recomputing eligibility failed", error),
  });
}
