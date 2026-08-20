import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useReimbursementStrategy } from "@/hooks/useReimbursementStrategy";

export interface AttentionSummary {
  totalCount: number;
  unreviewedTransactions: number;
  unlinkedMedical: number;
  overdueUnpaid: number;
  hsaClaimable: number;
  isShoebox: boolean;
  isLoading: boolean;
}

export function useAttentionItems(): AttentionSummary {
  const { user } = useAuthUser();
  const userId = user?.id;
  const { isShoebox, isLoading: strategyLoading } = useReimbursementStrategy();

  const { data, isLoading } = useQuery({
    queryKey: ["attention-items", userId],
    enabled: !!userId,
    queryFn: async () => {
      // Run all counts in parallel
      const [
        unreviewedResult,
        unlinkedMedicalResult,
        overdueUnpaidResult,
        hsaClaimableResult,
      ] = await Promise.all([
        // 1. Unreviewed transactions (needs_review = true)
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("needs_review", true),

        // 2. Unlinked medical transactions
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("is_medical", true)
          .eq("reconciliation_status", "unlinked"),

        // 3. Unpaid invoices older than 30 days
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("status", "unpaid")
          .lt(
            "date",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          ),

        // 4. HSA-claimable amount.
        //
        // Reads the facets directly rather than the derived is_hsa_eligible /
        // is_reimbursed booleans, which were wrong here. is_reimbursed is only
        // true for claim_state 'reimbursed'/'reimbursed_externally', so
        // `is_reimbursed = false` also matched two kinds of money that can
        // never be claimed: 'not_reimbursable' (already paid with the HSA card
        // -- the double-count the brief calls out as the most important guard)
        // and 'locked_in_request' (already committed to an open request).
        // Claimable is exactly eligible + unclaimed.
        supabase
          .from("invoices")
          .select("amount")
          .eq("user_id", userId!)
          .eq("eligibility_state", "eligible")
          .eq("claim_state", "unclaimed"),
      ]);

      if (unreviewedResult.error)
        logError("Attention: unreviewed query", unreviewedResult.error);
      if (unlinkedMedicalResult.error)
        logError("Attention: unlinked query", unlinkedMedicalResult.error);
      if (overdueUnpaidResult.error)
        logError("Attention: overdue query", overdueUnpaidResult.error);
      if (hsaClaimableResult.error)
        logError("Attention: HSA query", hsaClaimableResult.error);

      const hsaClaimable = (hsaClaimableResult.data || []).reduce(
        (sum, inv) => sum + Number(inv.amount),
        0,
      );

      return {
        unreviewedTransactions: unreviewedResult.count ?? 0,
        unlinkedMedical: unlinkedMedicalResult.count ?? 0,
        overdueUnpaid: overdueUnpaidResult.count ?? 0,
        hsaClaimable,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const unreviewedTransactions = data?.unreviewedTransactions ?? 0;
  const unlinkedMedical = data?.unlinkedMedical ?? 0;
  const overdueUnpaid = data?.overdueUnpaid ?? 0;

  // Workstream E6. A shoebox user has deliberately chosen not to claim, so
  // "$12,400 ready to claim" with a Claim button is not a helpful nudge — it
  // is the app telling them their completed work is unfinished. Zeroed at the
  // source rather than hidden in the banner, so anything else that reads this
  // summary inherits the suppression instead of having to remember it.
  //
  // Only this figure is suppressed. Unreviewed transactions and unlinked
  // medical spend are still real work for a shoebox user: the documentation is
  // the entire point of the strategy, and letting it rot is the one thing that
  // actually costs them the deduction decades later.
  const hsaClaimable = isShoebox ? 0 : (data?.hsaClaimable ?? 0);

  return {
    totalCount: unreviewedTransactions + unlinkedMedical + overdueUnpaid,
    unreviewedTransactions,
    unlinkedMedical,
    overdueUnpaid,
    hsaClaimable,
    isShoebox,
    isLoading: isLoading || strategyLoading,
  };
}
