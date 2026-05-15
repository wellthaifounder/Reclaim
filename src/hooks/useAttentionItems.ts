import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export interface AttentionSummary {
  totalCount: number;
  unreviewedTransactions: number;
  unlinkedMedical: number;
  overdueUnpaid: number;
  hsaClaimable: number;
  isLoading: boolean;
}

export function useAttentionItems(): AttentionSummary {
  const { user } = useAuthUser();
  const userId = user?.id;

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

        // 4. HSA-claimable amount (HSA-eligible, not reimbursed)
        supabase
          .from("invoices")
          .select("amount")
          .eq("user_id", userId!)
          .eq("is_hsa_eligible", true)
          .eq("is_reimbursed", false),
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
  const hsaClaimable = data?.hsaClaimable ?? 0;

  return {
    totalCount: unreviewedTransactions + unlinkedMedical + overdueUnpaid,
    unreviewedTransactions,
    unlinkedMedical,
    overdueUnpaid,
    hsaClaimable,
    isLoading,
  };
}
