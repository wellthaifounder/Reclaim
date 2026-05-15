import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export interface ClusterSuggestion {
  cluster_key: string;
  vendor: string;
  min_date: string;
  max_date: string;
  invoice_count: number;
  total_amount: number;
  invoice_ids: string[];
}

export function useClusterSuggestions() {
  const { user } = useAuthUser();
  const userId = user?.id;

  return useQuery({
    queryKey: ["cluster-suggestions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_invoice_clusters", {
        p_user_id: userId!,
      });

      if (error) {
        logError("Cluster suggestions query failed", error);
        throw error;
      }

      return (data || []) as ClusterSuggestion[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
