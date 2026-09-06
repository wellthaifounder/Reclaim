// Workstream C4 — the review feed.
//
// Sourced from transactions, grouped by merchant, and scoped to likely-medical
// only. The old queue showed every unreviewed transaction one at a time, which
// meant a user with three years of history and eighteen Walgreens trips made
// eighteen identical decisions.
//
// Two facts from earlier in the rebuild shape this:
//
//   - The classifier's MCC tier never fired (it read `txn.mcc`, a field Plaid
//     does not return), so *every* medical transaction fell through to a tier
//     that sets needs_review. The queue was flooded structurally, not because
//     the keyword list was bad. Grouping is what makes a backlog that size
//     clearable at all.
//   - Non-medical transactions are auto-decided and never enter the feed. The
//     user should never be asked about Netflix.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import type { RuleMatchType } from "@/lib/merchantNormalize";

export interface ReviewGroup {
  /** Normalized merchant name; the key bulk actions address. */
  merchant_key: string;
  /** Prettiest real descriptor seen in the group, for display. */
  display_name: string;
  txn_count: number;
  total_amount: number;
  earliest_date: string;
  latest_date: string;
  /** Why the classifier thought this was medical. Shown as the "why" chip. */
  explanation: string | null;
  /** Present only when every transaction in the group agrees on it. */
  merchant_entity_id: string | null;
  mcc: string | null;
}

/**
 * The most durable rule key for a whole group.
 *
 * Prefers Plaid's stable merchant id, then the merchant name. MCC is
 * deliberately last and only used when there is no name at all: an MCC rule
 * covers an entire category, so offering it for "Walgreens is medical" would
 * quietly sweep in every other pharmacy.
 */
export function groupRuleKey(
  group: ReviewGroup,
): { matchType: RuleMatchType; matchValue: string } | null {
  if (group.merchant_entity_id) {
    return {
      matchType: "merchant_entity",
      matchValue: group.merchant_entity_id,
    };
  }
  if (group.merchant_key) {
    return { matchType: "name_pattern", matchValue: group.merchant_key };
  }
  if (group.mcc) {
    return { matchType: "mcc", matchValue: group.mcc };
  }
  return null;
}

export function useReviewFeed() {
  const queryClient = useQueryClient();

  const feedQuery = useQuery({
    queryKey: ["review-feed"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ReviewGroup[]> => {
      const { data, error } = await supabase.rpc("review_feed_groups", {
        p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []).map((g) => ({
        ...g,
        txn_count: Number(g.txn_count),
        total_amount: Number(g.total_amount),
      })) as ReviewGroup[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["review-feed"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    // The nav badge (sidebar + top nav) reads this query, via
    // AuthenticatedLayout. Without it, deciding a merchant here cleared the
    // review feed itself but left the badge showing the pre-decision count
    // until something else happened to refetch it.
    queryClient.invalidateQueries({ queryKey: ["attention-items"] });
  };

  /**
   * Decide a whole merchant at once.
   *
   * Only touches transactions still awaiting review — deciding what the user
   * put in the queue is the point of the queue, whereas revising decisions
   * they already made belongs behind a rule and its explicit Apply button.
   */
  const decideGroup = useMutation({
    mutationFn: async (input: {
      merchantKey: string;
      isMedical: boolean;
    }): Promise<number> => {
      const { data, error } = await supabase.rpc("bulk_review_merchant", {
        p_merchant_key: input.merchantKey,
        p_is_medical: input.isMedical,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Bulk merchant review failed", error),
  });

  const totalPending = (feedQuery.data ?? []).reduce(
    (sum, g) => sum + g.txn_count,
    0,
  );

  return {
    groups: feedQuery.data ?? [],
    totalPending,
    isLoading: feedQuery.isLoading,
    error: feedQuery.error,
    decideGroup,
    refetch: feedQuery.refetch,
  };
}
