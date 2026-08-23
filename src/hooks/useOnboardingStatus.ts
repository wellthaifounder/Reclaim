// Step 0 — has this person been through setup, and what do they still owe us?
//
// Replaces the localStorage flag in OnboardingContext, which was per-browser:
// the same user setting up on a laptop and then signing in on a phone was
// treated as brand new on the phone, and clearing site data erased the fact
// that they had ever configured anything.
//
// The spec's ordering is the whole point of this file. Connect a bank, run the
// lookback, show what we found -- and only THEN ask for the HSA establishment
// date, the household, and the reimbursement strategy. Asking first is named in
// the spec as "the highest drop-off point in the funnel", because it is three
// pieces of homework in exchange for nothing.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export interface OnboardingStatus {
  /** Setup finished or dismissed. Null while we do not know yet. */
  isComplete: boolean | null;
  /** At least one bank connected — the spec's step 1. */
  hasBank: boolean;
  /** HSA establishment date on file, guessed or otherwise. */
  hasHsaDate: boolean;
  /** True when the date came from "I'm not sure" and is January 1 of a year. */
  hsaDateIsEstimate: boolean;
  isLoading: boolean;
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuthUser();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-status", userId],
    enabled: !!userId,
    // Short, because completing a step should visibly change the app rather
    // than waiting out a five-minute cache.
    staleTime: 30 * 1000,
    queryFn: async () => {
      const [profileRes, bankRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "onboarding_completed_at, hsa_opened_date, hsa_opened_date_is_estimate",
          )
          .eq("id", userId!)
          .maybeSingle(),
        supabase
          .from("plaid_connections")
          .select("id")
          .eq("user_id", userId!)
          .limit(1),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (bankRes.error) throw bankRes.error;

      return {
        completedAt: profileRes.data?.onboarding_completed_at ?? null,
        hsaDate: profileRes.data?.hsa_opened_date ?? null,
        estimate: profileRes.data?.hsa_opened_date_is_estimate ?? false,
        hasBank: (bankRes.data?.length ?? 0) > 0,
      };
    },
    meta: {
      // A failure here must not pop a toast. It is read on every dashboard
      // load purely to decide a redirect, and the user did not ask for it.
      suppressErrorToast: true,
    },
  });

  return {
    // Undefined (still loading, or no profile row yet) reports null rather
    // than false. Reporting false would bounce an existing user into the
    // welcome flow for the moment before their profile arrives.
    isComplete: data ? data.completedAt !== null : null,
    hasBank: data?.hasBank ?? false,
    hasHsaDate: !!data?.hsaDate,
    hsaDateIsEstimate: data?.estimate ?? false,
    isLoading,
  };
}

/**
 * Mark setup finished, or clear it to walk the flow again.
 *
 * Finishing and skipping both stamp the same column. Skipping is not a
 * different state -- it is the same state reached with fewer answers, and every
 * question the user skipped is asked again later at the point where it actually
 * blocks something (the timing gate asks for the HSA date; substantiation asks
 * who the expense was for). Nagging up front buys nothing that asking in
 * context does not.
 */
export function useSetOnboardingComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (complete: boolean) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in.");

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          onboarding_completed_at: complete ? new Date().toISOString() : null,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
    onError: (error) => logError("Saving onboarding state failed", error),
  });
}
