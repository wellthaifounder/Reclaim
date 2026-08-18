import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export type ReimbursementStrategy = "regular" | "shoebox";

/**
 * Workstream E6 — how this user intends to use their HSA.
 *
 * From the workflow spec: "Users pursuing the shoebox strategy deliberately do
 * not reimburse, letting the HSA compound tax-free while holding documentation
 * for decades. For them, a fully substantiated, unclaimed expense is FINISHED,
 * and the app must never nag about it."
 *
 * This is a preference, not a feature flag: nothing is withheld from a shoebox
 * user. They can still generate a claim whenever they want. What changes is
 * whether a documented expense reads as an outstanding task or as a completed
 * one, and that difference is the whole point -- a product that tells someone
 * they have 40 unfinished items when they have deliberately finished all 40 is
 * telling them they are doing it wrong.
 *
 * One hook because Dashboard and Settings each fetched this column separately
 * before, and every new surface would have been a third copy of the same
 * question, free to disagree with the other two about the answer.
 */
export function useReimbursementStrategy(): {
  strategy: ReimbursementStrategy;
  isShoebox: boolean;
  isLoading: boolean;
} {
  const { user } = useAuthUser();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["reimbursement-strategy", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ReimbursementStrategy> => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select("reimbursement_strategy_preference")
        .eq("id", userId!)
        .maybeSingle();
      if (error) {
        logError("useReimbursementStrategy", error);
        return "regular";
      }
      // 'regular' on anything unexpected, including a missing profile row.
      // Defaulting the other way would silence reminders for someone who
      // never asked for that, and a claim they forget to file is money.
      return row?.reimbursement_strategy_preference === "shoebox"
        ? "shoebox"
        : "regular";
    },
    staleTime: 5 * 60 * 1000,
  });

  const strategy = data ?? "regular";
  return {
    strategy,
    // While loading we report 'regular', so the shoebox label never flashes
    // onto a regular user's dashboard. The reverse flash is the safe one: a
    // shoebox user briefly sees a prompt, rather than a regular user briefly
    // being told their unclaimed money is finished business.
    isShoebox: strategy === "shoebox",
    isLoading,
  };
}
