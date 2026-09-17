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
import { useAuthUser } from "@/hooks/useAuthUser";
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
  /**
   * Derived from is_medical, not from why the engine flagged the row (spec
   * D41).
   *
   * 'medical': the classifier thinks this IS healthcare — confirm or reject.
   * 'possible_otc': the classifier is only asking. Baskets that may contain
   * an IRS-qualifying item, and merchants it could not read at all, share
   * this lane, because to the user they are the same question. `is_medical`
   * is false on every row in it until a decision or a split changes that.
   *
   * The value keeps its old spelling on the wire on purpose: renaming it
   * would empty the lane on screen between the migration landing and the
   * frontend deploying. Read it as "the engine is unsure", not as "OTC".
   */
  lane: "medical" | "possible_otc";
  /**
   * Populated only when txn_count is 1 — the only case ExpenseSplitDialog can
   * act on unambiguously, since splitting means picking one specific basket.
   * For a larger group, useReviewGroupTransactions supplies the individual
   * baskets instead.
   */
  single_transaction_id: string | null;
}

/** One transaction inside a group, once the user opens the group up. */
export interface ReviewGroupTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  category: string | null;
  classification_explanation: string | null;
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

/**
 * The transactions behind one group row, fetched only once the user opens it.
 *
 * A group of five Costco trips has no single basket to split, so the row used
 * to offer nothing but a sentence pointing at another page. This is what lets
 * it offer the actual transactions instead.
 *
 * Deliberately lazy: `enabled` is false until a merchant key is passed, so
 * collapsed groups cost nothing. Keyed by user as well as group for the same
 * reason the feed query is — see the comment on that query.
 */
export function useReviewGroupTransactions(
  merchantKey: string | null,
  lane: ReviewGroup["lane"] | null,
) {
  const { user } = useAuthUser();
  const userId = user?.id;

  return useQuery({
    queryKey: ["review-group-transactions", userId, merchantKey, lane],
    enabled: !!userId && !!merchantKey,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ReviewGroupTransaction[]> => {
      const { data, error } = await supabase.rpc(
        "review_feed_group_transactions",
        {
          p_merchant_key: merchantKey as string,
          ...(lane ? { p_lane: lane } : {}),
        },
      );
      if (error) throw error;
      return (data ?? []).map((t) => ({
        ...t,
        amount: Number(t.amount),
      })) as ReviewGroupTransaction[];
    },
  });
}

/**
 * Spec D28: how many transactions were filed as not-healthcare without the
 * user ever seeing them, for the one-sentence nudge on the empty queue --
 * "Transactions that clearly aren't healthcare are auto-filed. That is
 * correct... but if nothing ever surfaces what was auto-dismissed, a miss
 * [in the classifier] is invisible forever."
 *
 * The predicate must mirror `matchesNamedView`'s 'auto_filed' case in
 * Transactions.tsx exactly, or the nudge's count and the view it links to
 * (`/transactions?tab=all&view=auto_filed`) will disagree. A transfer was
 * never a healthcare judgement at all, so it's excluded here the same way.
 */
export function useAutoFiledCount() {
  const { user } = useAuthUser();
  const userId = user?.id;

  return useQuery({
    queryKey: ["auto-filed-count", userId],
    enabled: !!userId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId as string)
        .eq("is_medical", false)
        .eq("is_transfer", false)
        .not("classification_reason", "is", null)
        .not("classification_reason", "in", '("user","transfer")')
        // SQL's <> is unknown (excludes the row) against a NULL
        // reconciliation_status, unlike the JS `!==` matchesNamedView uses --
        // spelled out with .or so a null reads as "not ignored" here too.
        .or("reconciliation_status.is.null,reconciliation_status.neq.ignored");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useReviewFeed() {
  const queryClient = useQueryClient();
  // review_feed_groups is SECURITY INVOKER and filters on auth.uid(). Fired
  // before the session has been restored it returns zero rows -- correctly,
  // there is no user -- and react-query then serves that empty answer from
  // cache for a full staleTime. That is the "open the bookmark and it says
  // Nothing to review, open it again and everything is there" bug: the first
  // visit raced the session, the second was served real data. Keyed by user and
  // gated on having one, the query cannot run before there is somebody to run
  // it for, and two accounts can never share a cache entry.
  const { user } = useAuthUser();
  const userId = user?.id;

  const feedQuery = useQuery({
    queryKey: ["review-feed", userId],
    enabled: !!userId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ReviewGroup[]> => {
      const { data, error } = await supabase.rpc("review_feed_groups", {
        p_limit: 75,
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
    // An opened group holds its own copy of the rows. Splitting one of them
    // decides it, so without this the transaction stays listed inside the open
    // group until something else refetches -- offering to split a basket that
    // has already been split.
    queryClient.invalidateQueries({ queryKey: ["review-group-transactions"] });
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
      lane?: ReviewGroup["lane"];
    }): Promise<number> => {
      const { data, error } = await supabase.rpc("bulk_review_merchant", {
        p_merchant_key: input.merchantKey,
        p_is_medical: input.isMedical,
        p_lane: input.lane,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Bulk merchant review failed", error),
  });

  /**
   * Decide ONE transaction inside an opened group.
   *
   * A merchant whose baskets vary needs an answer per basket, not per merchant:
   * one Walmart trip really was the pharmacy, the next four were groceries.
   * The group-level buttons cannot express that.
   *
   * Goes through decide_transactions -- the same RPC the Transactions page uses
   * -- rather than a plain table update, so every route stamps identical
   * provenance and the expense-creating trigger sees one shape of write. That
   * trigger is also why this returns the expense id: confirming a transaction
   * as medical CREATES the expense and writes it back to transactions.invoice_id
   * (20260906120000), and the caller needs that id to offer the receipt step
   * before the row leaves the queue.
   */
  const decideTransaction = useMutation({
    mutationFn: async (input: {
      transactionId: string;
      isMedical: boolean;
    }): Promise<{ expenseId: string | null }> => {
      const { error } = await supabase.rpc("decide_transactions", {
        p_transaction_ids: [input.transactionId],
        p_is_medical: input.isMedical,
      });
      if (error) throw error;

      // Nothing to substantiate when it is not medical -- no expense exists.
      if (!input.isMedical) return { expenseId: null };

      const { data, error: readError } = await supabase
        .from("transactions")
        .select("invoice_id")
        .eq("id", input.transactionId)
        .single();
      // A failed read must not fail the decision: the expense exists either
      // way, and it is waiting under Expenses. Only the offer to attach a
      // receipt right now is lost.
      if (readError) {
        logError("Could not read back the new expense id", readError);
        return { expenseId: null };
      }
      return { expenseId: data?.invoice_id ?? null };
    },
    onSuccess: invalidate,
    onError: (error) => logError("Single transaction decision failed", error),
  });

  const allGroups = feedQuery.data ?? [];
  const medicalGroups = allGroups.filter((g) => g.lane === "medical");
  const otcGroups = allGroups.filter((g) => g.lane === "possible_otc");
  const totalPending = allGroups.reduce((sum, g) => sum + g.txn_count, 0);

  return {
    groups: allGroups,
    medicalGroups,
    otcGroups,
    totalPending,
    isLoading: feedQuery.isLoading,
    error: feedQuery.error,
    decideGroup,
    decideTransaction,
    invalidate,
    refetch: feedQuery.refetch,
  };
}
