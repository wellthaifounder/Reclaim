// Workstream C6 — duplicate expense warnings.
//
// The case this exists for, measured against the schema before it was built: a
// $240 dental visit entered by hand on the day of the appointment, then
// delivered by the bank four days later when the card settled, produced two
// eligible and unclaimed expenses — $480 of claimable money for $240 of real
// spending, with nothing warning about it.
//
// The inclusion lock in E2 cannot catch this. It stops one expense entering two
// requests; here there are genuinely two expense records, so from the lock's
// point of view nothing is wrong.
//
// Resolution is always the user's. Detection raises candidates and never
// merges: a wrong auto-merge would silently delete a real expense, which is a
// worse outcome than the double-count it would be preventing.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

export type DuplicateMatchReason = "manual_vs_synced" | "same_charge";

export interface DuplicateExpenseSide {
  id: string;
  vendor: string;
  date: string;
  amount: number;
  source: string | null;
  documentation_state: string;
  eligibility_state: string;
  patient_name: string | null;
  notes: string | null;
  /** Present when this record came from the bank rather than manual entry. */
  source_plaid_transaction_id: string | null;
  receipt_count: number;
}

export interface DuplicateCandidate {
  id: string;
  match_reason: DuplicateMatchReason;
  confidence: number;
  detected_at: string;
  a: DuplicateExpenseSide;
  b: DuplicateExpenseSide;
}

/**
 * Plain-English account of why a pair was raised, shown above the comparison.
 *
 * The two reasons carry genuinely different weight and the copy says so.
 * `same_charge` is frequently a false alarm — two copays for two children on
 * one day look identical — so it must not be phrased as an accusation.
 */
export function explainDuplicate(c: DuplicateCandidate): string {
  if (c.match_reason === "manual_vs_synced") {
    return "You added this one yourself and your bank sent the other. They look like the same charge.";
  }
  return "Two records with the same amount at the same place, a day or two apart. They might both be real.";
}

/**
 * Which record to suggest keeping.
 *
 * The bank record carries the amount that actually left the account, so it is
 * the better base when the two disagree. But documentation is the harder thing
 * to recreate, so a record with receipts wins over one without.
 */
export function suggestedKeeper(c: DuplicateCandidate): DuplicateExpenseSide {
  if (c.a.receipt_count !== c.b.receipt_count) {
    return c.a.receipt_count > c.b.receipt_count ? c.a : c.b;
  }
  const aSynced = !!c.a.source_plaid_transaction_id;
  const bSynced = !!c.b.source_plaid_transaction_id;
  if (aSynced !== bSynced) return aSynced ? c.a : c.b;
  return c.a;
}

const SIDE_COLUMNS =
  "id, vendor, date, amount, amount_paid, source, documentation_state, eligibility_state, patient_name, notes, source_plaid_transaction_id";

export function useDuplicateCandidates() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["duplicate-candidates"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<DuplicateCandidate[]> => {
      const { data: rows, error } = await supabase
        .from("expense_duplicate_candidates")
        .select(
          "id, expense_a_id, expense_b_id, match_reason, confidence, detected_at",
        )
        .eq("status", "open")
        .order("confidence", { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      // One batched fetch for both sides of every pair rather than two per
      // candidate — the N+1 this avoids is small at 3 warnings and painful at
      // 30, which is a realistic first-sync number for someone who has been
      // tracking expenses by hand.
      const expenseIds = Array.from(
        new Set(rows.flatMap((r) => [r.expense_a_id, r.expense_b_id])),
      );

      const [{ data: expenses, error: expErr }, { data: receipts }] =
        await Promise.all([
          supabase.from("invoices").select(SIDE_COLUMNS).in("id", expenseIds),
          supabase
            .from("receipts")
            .select("invoice_id")
            .in("invoice_id", expenseIds),
        ]);
      if (expErr) throw expErr;

      const receiptCounts = new Map<string, number>();
      for (const r of receipts ?? []) {
        if (!r.invoice_id) continue;
        receiptCounts.set(
          r.invoice_id,
          (receiptCounts.get(r.invoice_id) ?? 0) + 1,
        );
      }

      const byId = new Map<string, DuplicateExpenseSide>(
        (expenses ?? []).map((e) => [
          e.id,
          {
            id: e.id,
            vendor: e.vendor,
            date: e.date,
            // amount_paid is the money model's source of truth; `amount` is
            // the legacy column kept in step with it.
            amount: Number(e.amount_paid ?? e.amount ?? 0),
            source: e.source,
            documentation_state: e.documentation_state,
            eligibility_state: e.eligibility_state,
            patient_name: e.patient_name,
            notes: e.notes,
            source_plaid_transaction_id: e.source_plaid_transaction_id,
            receipt_count: receiptCounts.get(e.id) ?? 0,
          },
        ]),
      );

      return rows
        .map((r) => {
          const a = byId.get(r.expense_a_id);
          const b = byId.get(r.expense_b_id);
          // A side can be missing if the expense was deleted between the two
          // queries. Dropping the pair is right — there is no longer a
          // duplicate — and the stale candidate row is already gone by cascade.
          if (!a || !b) return null;
          return {
            id: r.id,
            match_reason: r.match_reason as DuplicateMatchReason,
            confidence: r.confidence,
            detected_at: r.detected_at,
            a,
            b,
          };
        })
        .filter((c): c is DuplicateCandidate => c !== null);
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["duplicate-candidates"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["claimable-events"] });
  };

  /** Fold one record into the other. Documents and the bank link move across. */
  const merge = useMutation({
    mutationFn: async (input: { candidateId: string; keepId: string }) => {
      const { data, error } = await supabase.rpc("merge_duplicate_expenses", {
        p_candidate_id: input.candidateId,
        p_keep_id: input.keepId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Merging duplicate expenses failed", error),
  });

  /**
   * Re-scan for pairs.
   *
   * A safety net rather than the main trigger. Ingestion runs detection after
   * every sync and manual entry runs it on save, but expenses are also created
   * by the upload wizards and by splitting, and a warning that only appears
   * after the *next* bank sync is a warning that arrives after the user has
   * already built their reimbursement request. Cheap and idempotent — a pair
   * already raised or already dismissed is skipped in SQL.
   */
  const runDetection = useMutation({
    mutationFn: async (): Promise<number> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return 0;
      const { data, error } = await supabase.rpc("detect_duplicate_expenses", {
        p_user_id: user.id,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (found) => {
      if (found > 0) {
        queryClient.invalidateQueries({ queryKey: ["duplicate-candidates"] });
      }
    },
    onError: (error) => logError("Duplicate detection failed", error),
  });

  /** Keep both. Permanent — the pair is never raised again. */
  const dismiss = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase.rpc("dismiss_duplicate_candidate", {
        p_candidate_id: candidateId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Dismissing duplicate warning failed", error),
  });

  return {
    candidates: query.data ?? [],
    count: query.data?.length ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    merge,
    dismiss,
    runDetection,
    refetch: query.refetch,
  };
}
