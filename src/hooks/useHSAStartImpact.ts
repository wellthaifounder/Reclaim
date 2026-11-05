// Founder decision, 2026-11-04 (L2): before an HSA account change is saved,
// say so if it moves the HSA start later, and how many expenses that costs.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { startMovesLater } from "@/lib/hsaAccountUtils";

export interface HSAStartMove {
  from: string;
  to: string;
  /** Expenses that would stop being claimable. null while counting. */
  count: number | null;
}

/**
 * Non-null when moving the HSA start from `current` to `next` moves it later.
 *
 * Counts what recompute_expense_eligibility would newly refuse: expenses dated
 * (by date of service, else payment) before the new start that are not
 * already ineligible. Only 'unclaimed' ones -- an expense paid with the HSA
 * card was never claimable, and one inside a sent claim is never recomputed.
 * So it matches the number the recompute reports as blocked, less HSA-card
 * expenses and any already-refused expense that is only relabelled.
 */
export function useHSAStartImpact(
  current: string | null,
  next: string | null,
): HSAStartMove | null {
  const { user } = useAuthUser();
  const userId = user?.id;
  const movesLater = startMovesLater(current, next);

  const { data } = useQuery({
    queryKey: ["hsa-start-impact", userId, next],
    enabled: movesLater && !!userId,
    // Always fresh: the answer changes with every save and recompute.
    staleTime: 0,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!)
        .lt("effective_service_date", next!)
        .neq("eligibility_state", "ineligible")
        .eq("claim_state", "unclaimed");
      if (error) throw error;
      return count ?? 0;
    },
    // The line still shows the move without a count; no toast for this.
    meta: { suppressErrorToast: true },
  });

  if (!movesLater) return null;
  return { from: current!, to: next!, count: data ?? null };
}
