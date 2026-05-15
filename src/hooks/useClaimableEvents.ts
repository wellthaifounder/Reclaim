import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export interface ClaimableCareEvent {
  collection_id: string;
  title: string;
  hsa_eligible_amount: number;
  total_paid: number;
  paid_via_hsa: number;
  oop_claimable: number;
  invoice_count: number;
  unreimbursed_invoice_ids: string[];
}

export function useClaimableEvents(threshold = 50) {
  const { user } = useAuthUser();
  const userId = user?.id;

  return useQuery({
    queryKey: ["claimable-care-events", threshold, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "detect_claimable_care_events",
        {
          p_user_id: userId!,
          p_threshold: threshold,
        },
      );

      if (error) {
        logError("Claimable care events query failed", error);
        throw error;
      }

      return (data || []) as ClaimableCareEvent[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
