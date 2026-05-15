import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

export interface InsurancePlan {
  carrier: string;
  plan_type: string;
  deductible?: number;
  deductible_met?: number;
  out_of_pocket_max?: number;
  out_of_pocket_met?: number;
  updated_at: string;
}

export function useInsurancePlan() {
  const { user } = useAuthUser();
  const userId = user?.id;

  const { data: profile, isLoading } = useQuery({
    queryKey: ["insurance-plan", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("insurance_plan")
        .eq("id", userId!)
        .single();

      if (error) {
        // If no profile exists yet, return null
        if (error.code === "PGRST116") return null;
        throw error;
      }

      return data;
    },
  });

  const insurancePlan = profile?.insurance_plan as InsurancePlan | null;
  const hasInsurancePlan =
    !!insurancePlan?.carrier && !!insurancePlan?.plan_type;

  // Calculate remaining amounts
  const deductibleRemaining =
    insurancePlan?.deductible && insurancePlan?.deductible_met
      ? Math.max(0, insurancePlan.deductible - insurancePlan.deductible_met)
      : null;

  const outOfPocketRemaining =
    insurancePlan?.out_of_pocket_max && insurancePlan?.out_of_pocket_met
      ? Math.max(
          0,
          insurancePlan.out_of_pocket_max - insurancePlan.out_of_pocket_met,
        )
      : null;

  const deductibleMet = deductibleRemaining === 0;
  const outOfPocketMet = outOfPocketRemaining === 0;

  return {
    insurancePlan,
    hasInsurancePlan,
    deductibleRemaining,
    outOfPocketRemaining,
    deductibleMet,
    outOfPocketMet,
    isLoading,
  };
}
