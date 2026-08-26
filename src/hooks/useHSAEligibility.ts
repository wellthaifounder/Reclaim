// Workstream D2 — Gate 1, timing.
//
// Rewritten. The previous version reimplemented the establishment-date cliff
// in TypeScript: it read hsa_accounts with SELECT * (against the rule in
// CLAUDE.md), fell back to profiles.hsa_opened_date, and compared dates in the
// browser. It also had no callers at all.
//
// Two implementations of a hard IRS rule that can disagree is the exact defect
// class this rebuild keeps unwinding, so the cliff now lives in one place —
// `hsa_establishment_date` and `expense_timing_gate` in the database — and
// this file only reads it.
//
// The rule itself: HSA money can only pay for care received ON OR AFTER the
// day the HSA was established. One day early is never eligible, ever, and no
// amount of documentation changes that. It is reported, never asked.
//
// Note it keys on DATE OF SERVICE, not date of payment. A December visit paid
// in January is a December expense, and against a January 1 cliff those are
// opposite answers.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export type TimingStatus = "eligible" | "ineligible" | "unknown";

export interface TimingGateResult {
  status: TimingStatus;
  service_date: string | null;
  establishment_date: string | null;
  /**
   * True when we fell back to the payment date because no date of service was
   * recorded. Worth surfacing: the fallback is safe against the cliff (payment
   * is never earlier than care) but it can mis-assign a tax year.
   */
  uses_payment_date: boolean;
  reason: string;
}

/** The day this user's HSA became usable. null = they haven't told us. */
export function useHSAEstablishmentDate() {
  const { user } = useAuthUser();

  const query = useQuery({
    queryKey: ["hsa-establishment-date", user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc("hsa_establishment_date", {
        p_user_id: user!.id,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  return {
    establishmentDate: query.data ?? null,
    /** No date on file — the gate can't run and the user should be asked. */
    isUnset: !query.isLoading && !query.data,
    isLoading: query.isLoading,
  };
}

/** Gate 1 for one saved expense, with the explanation to show the user. */
export function useTimingGate(invoiceId: string | null) {
  const query = useQuery({
    queryKey: ["timing-gate", invoiceId],
    enabled: !!invoiceId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<TimingGateResult | null> => {
      const { data, error } = await supabase.rpc("expense_timing_gate", {
        p_invoice_id: invoiceId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as TimingGateResult) ?? null;
    },
  });

  return { gate: query.data ?? null, isLoading: query.isLoading };
}

/**
 * Check a date before an expense exists — for entry forms, where there is no
 * row to pass to the gate yet.
 *
 * Compares against the same establishment date the database uses, so the
 * warning a user sees while typing matches the verdict they get after saving.
 */
export function useHSAEligibility(serviceDate: string | Date | null): {
  status: TimingStatus;
  establishmentDate: string | null;
  message: string | null;
  isLoading: boolean;
} {
  const { establishmentDate, isLoading } = useHSAEstablishmentDate();

  if (isLoading || !serviceDate) {
    return { status: "unknown", establishmentDate, message: null, isLoading };
  }
  if (!establishmentDate) {
    return {
      status: "unknown",
      establishmentDate: null,
      message:
        "Add the date you opened your HSA and we can tell you whether this is claimable.",
      isLoading: false,
    };
  }

  // Compare as plain calendar dates. Constructing a Date from "2024-01-01"
  // yields UTC midnight, which is the previous day in any negative-offset
  // timezone — enough to flip a cliff decision for anyone in the US.
  const asKey = (d: string | Date) =>
    typeof d === "string" ? d.slice(0, 10) : d.toLocaleDateString("en-CA");

  const service = asKey(serviceDate);
  if (service < establishmentDate) {
    return {
      status: "ineligible",
      establishmentDate,
      message: `Care received before ${establishmentDate} can't be paid from your HSA — that's the day it was opened.`,
      isLoading: false,
    };
  }
  return {
    status: "eligible",
    establishmentDate,
    message: null,
    isLoading: false,
  };
}

/**
 * Re-apply the cliff across every expense. Run whenever the HSA date changes.
 *
 * Replaces two hand-written bulk updates that were both filtered on
 * `is_hsa_eligible = true` — a generated column meaning eligibility_state is
 * 'eligible'. Since expenses default to 'unknown', that filter matched almost
 * nothing and the gate had effectively stopped firing.
 *
 * It also restores, which the old code never did: a user who mistyped their
 * HSA year and corrected it previously kept every wrongly-blocked expense
 * blocked forever, with no way back and nothing telling them.
 */
export function useRecomputeTiming() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{ blocked: number; restored: number }> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in.");

      const { data, error } = await supabase.rpc(
        "recompute_timing_eligibility",
        { p_user_id: user.id },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        blocked: Number(row?.blocked ?? 0),
        restored: Number(row?.restored ?? 0),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hsa-establishment-date"] });
      queryClient.invalidateQueries({ queryKey: ["timing-gate"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["claimable-events"] });
    },
    onError: (error) => logError("Recomputing HSA timing failed", error),
  });
}
