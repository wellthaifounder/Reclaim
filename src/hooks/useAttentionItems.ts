import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useReimbursementStrategy } from "@/hooks/useReimbursementStrategy";

export interface AttentionSummary {
  totalCount: number;
  unreviewedTransactions: number;
  /** Dollar value of those unreviewed transactions, same definition. */
  unreviewedAmount: number;
  unlinkedMedical: number;
  hsaClaimable: number;
  /** Expenses eligible and unclaimed -- ready for a reimbursement request. */
  readyToClaim: number;
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
      const [unreviewedResult, unlinkedMedicalResult, hsaClaimableResult] =
        await Promise.all([
          // 1. Unreviewed transactions.
          //
          // Selects `amount` rather than a head-only count so the same query
          // yields the dollar figure the dashboard's Categorize bucket shows.
          // Deriving that total from a second query with its own WHERE clause
          // is how a count and a total that describe the same rows start
          // disagreeing.
          //
          // These filters exist to match review_feed_groups() exactly. The
          // badge counted plain needs_review while the queue additionally
          // dropped ignored rows and split children, so any transaction that
          // satisfied one and not the other produced a badge advertising work
          // the queue could not show -- "Review 3" over "Nothing to review",
          // with no way to clear it. If you change the queue's WHERE clause,
          // change this too; they are one definition in two places.
          supabase
            .from("transactions")
            .select("amount", { count: "exact" })
            .eq("user_id", userId!)
            .eq("needs_review", true)
            // `.neq` alone would also drop rows whose status is NULL, because
            // NULL != 'ignored' is NULL, not true. The queue keeps those (it
            // uses COALESCE), so this has to keep them as well.
            .or(
              "reconciliation_status.is.null,reconciliation_status.neq.ignored",
            )
            .is("split_parent_id", null),

          // "Unpaid bills older than 30 days" removed 2026-08-21.
          //
          // It counted invoices.status = 'unpaid'. That column was maintained by
          // a trigger on the payments table, which is gone -- so the column now
          // sits at its default of 'unpaid' for every expense forever, and this
          // counter would have put the user's entire expense history in the
          // nav badge as overdue work. The idea was wrong here anyway: an
          // expense exists because the bank recorded the money leaving, so
          // "unpaid" describes none of them.

          // 2. Unlinked medical transactions
          supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId!)
            .eq("is_medical", true)
            .eq("reconciliation_status", "unlinked"),

          // 4. HSA-claimable amount.
          //
          // Reads the facets directly rather than the derived is_hsa_eligible /
          // is_reimbursed booleans, which were wrong here. is_reimbursed is only
          // true for claim_state 'reimbursed'/'reimbursed_externally', so
          // `is_reimbursed = false` also matched two kinds of money that can
          // never be claimed: 'not_reimbursable' (already paid with the HSA card
          // -- the double-count the brief calls out as the most important guard)
          // and 'locked_in_request' (already committed to an open request).
          // Claimable is exactly eligible + unclaimed. `count: "exact"`
          // alongside the row select gets both the dollar total (below) and a
          // ready-to-claim count in one query -- the count is what the nav
          // badge needs; see readyToClaim.
          supabase
            .from("invoices")
            .select("amount", { count: "exact" })
            .eq("user_id", userId!)
            .eq("eligibility_state", "eligible")
            .eq("claim_state", "unclaimed"),
        ]);

      if (unreviewedResult.error)
        logError("Attention: unreviewed query", unreviewedResult.error);
      if (unlinkedMedicalResult.error)
        logError("Attention: unlinked query", unlinkedMedicalResult.error);
      if (hsaClaimableResult.error)
        logError("Attention: HSA query", hsaClaimableResult.error);

      const hsaClaimable = (hsaClaimableResult.data || []).reduce(
        (sum, inv) => sum + Number(inv.amount),
        0,
      );

      return {
        unreviewedTransactions: unreviewedResult.count ?? 0,
        unreviewedAmount: (unreviewedResult.data || []).reduce(
          (sum, t) => sum + Math.abs(Number(t.amount) || 0),
          0,
        ),
        unlinkedMedical: unlinkedMedicalResult.count ?? 0,
        hsaClaimable,
        readyToClaim: hsaClaimableResult.count ?? 0,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const unreviewedTransactions = data?.unreviewedTransactions ?? 0;
  const unlinkedMedical = data?.unlinkedMedical ?? 0;

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
  // Same suppression, same reason: a shoebox user has chosen not to claim, so
  // a "ready to claim" badge is the app flagging their completed work as
  // unfinished.
  const readyToClaim = isShoebox ? 0 : (data?.readyToClaim ?? 0);

  return {
    totalCount: unreviewedTransactions + unlinkedMedical,
    unreviewedTransactions,
    unreviewedAmount: data?.unreviewedAmount ?? 0,
    unlinkedMedical,
    hsaClaimable,
    readyToClaim,
    isShoebox,
    isLoading: isLoading || strategyLoading,
  };
}
