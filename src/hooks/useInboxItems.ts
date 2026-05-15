import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError, safeLog } from "@/utils/errorHandler";
import { toast } from "sonner";
import { useCallback } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";

// PostgREST returns these codes when the schema is missing the relation
// (table not migrated yet). Treat as empty inbox rather than a page-level
// error — virtual items still render and the rest of the page stays usable.
const SCHEMA_MISSING_CODES = new Set(["PGRST205", "42P01"]);

export type InboxItemType =
  | "review_transaction"
  | "confirm_match"
  | "overdue_unpaid"
  | "hsa_claimable";

export interface InboxItem {
  id: string;
  item_type: InboxItemType;
  source_entity_id: string;
  source_entity_type: string;
  title: string;
  subtitle: string | null;
  amount: number | null;
  suggested_action: Record<string, unknown> | null;
  priority_score: number;
  status: string;
  created_at: string;
  /** True for computed items (overdue_unpaid, hsa_claimable) that aren't in the DB */
  isVirtual?: boolean;
}

export interface UseInboxItemsReturn {
  items: InboxItem[];
  isLoading: boolean;
  actOnItem: (item: InboxItem, action: string) => Promise<void>;
  dismissItem: (item: InboxItem) => Promise<void>;
  batchAct: (items: InboxItem[], action: string) => Promise<void>;
  batchDismiss: (items: InboxItem[]) => Promise<void>;
  refetch: () => void;
}

export function useInboxItems(): UseInboxItemsReturn {
  const queryClient = useQueryClient();
  const { user } = useAuthUser();
  const userId = user?.id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["inbox-items", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [] as InboxItem[];

      // Fetch persistent inbox items
      const { data: dbItems, error: dbError } = await supabase
        .from("inbox_items")
        .select(
          "id, user_id, item_type, source_entity_id, source_entity_type, title, subtitle, amount, suggested_action, priority_score, status, created_at, acted_at, expires_at",
        )
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("priority_score", { ascending: false })
        .limit(100);

      // If the inbox_items table isn't deployed yet, degrade to virtual-only
      // instead of breaking the page. Other errors still propagate.
      let safeDbItems = dbItems;
      if (dbError) {
        if (SCHEMA_MISSING_CODES.has(dbError.code ?? "")) {
          safeLog(
            "inbox_items table missing — degrading to virtual items only",
            dbError,
          );
          safeDbItems = [];
        } else {
          logError("Inbox items query failed", dbError);
          throw dbError;
        }
      }

      // Fetch computed virtual items in parallel
      const [overdueResult, hsaResult] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, vendor, amount, date")
          .eq("user_id", userId)
          .eq("status", "unpaid")
          .lt(
            "date",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          )
          .order("date", { ascending: true })
          .limit(20),
        supabase
          .from("invoices")
          .select("id, vendor, amount")
          .eq("user_id", userId)
          .eq("is_hsa_eligible", true)
          .eq("is_reimbursed", false)
          .limit(1),
      ]);

      const virtualItems: InboxItem[] = [];

      // Overdue unpaid bills (one item per bill, highest priority)
      if (overdueResult.data) {
        for (const inv of overdueResult.data) {
          const daysOverdue = Math.floor(
            (Date.now() - new Date(inv.date).getTime()) / (1000 * 60 * 60 * 24),
          );
          virtualItems.push({
            id: `virtual-overdue-${inv.id}`,
            item_type: "overdue_unpaid",
            source_entity_id: inv.id,
            source_entity_type: "invoice",
            title: inv.vendor,
            subtitle: `Unpaid for ${daysOverdue} days`,
            amount: Number(inv.amount),
            suggested_action: { action: "view", path: `/bills/${inv.id}` },
            priority_score: 100,
            status: "pending",
            created_at: inv.date,
            isVirtual: true,
          });
        }
      }

      // HSA claimable (single aggregate item)
      if (hsaResult.data && hsaResult.data.length > 0) {
        // Get the actual total
        const { data: hsaTotals } = await supabase
          .from("invoices")
          .select("amount")
          .eq("user_id", userId)
          .eq("is_hsa_eligible", true)
          .eq("is_reimbursed", false);

        const hsaTotal = (hsaTotals || []).reduce(
          (sum, inv) => sum + Number(inv.amount),
          0,
        );

        if (hsaTotal > 0) {
          virtualItems.push({
            id: "virtual-hsa-claimable",
            item_type: "hsa_claimable",
            source_entity_id: "aggregate",
            source_entity_type: "aggregate",
            title: `$${hsaTotal.toLocaleString()} HSA claimable`,
            subtitle: "HSA-eligible expenses ready to claim",
            amount: hsaTotal,
            suggested_action: {
              action: "navigate",
              path: "/hsa-reimbursement",
            },
            priority_score: 20,
            status: "pending",
            created_at: new Date().toISOString(),
            isVirtual: true,
          });
        }
      }

      // Merge and sort by priority
      const allItems: InboxItem[] = [
        ...virtualItems,
        ...(safeDbItems || []).map((item) => ({
          ...item,
          amount: item.amount ? Number(item.amount) : null,
          suggested_action: item.suggested_action as Record<
            string,
            unknown
          > | null,
          isVirtual: false,
        })),
      ].sort((a, b) => b.priority_score - a.priority_score);

      return allItems;
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    queryClient.invalidateQueries({ queryKey: ["attention-items"] });
    queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });
  }, [queryClient]);

  const actOnItem = useCallback(
    async (item: InboxItem, action: string) => {
      if (item.isVirtual) return; // Virtual items don't have DB records

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return;
      }

      try {
        if (item.item_type === "review_transaction") {
          const isMedical = action === "medical";
          const { error } = await supabase
            .from("transactions")
            .update({
              is_medical: isMedical,
              is_hsa_eligible: isMedical,
              needs_review: false,
              reconciliation_status: isMedical ? "unlinked" : "ignored",
            })
            .eq("id", item.source_entity_id);

          if (error) throw error;

          // Save vendor preference for future auto-classification
          if (item.title && item.title !== "Unknown Transaction") {
            const { error: prefError } = await supabase
              .from("user_vendor_preferences")
              .upsert(
                {
                  user_id: user.id,
                  vendor_pattern: item.title,
                  is_medical: isMedical,
                  times_confirmed: 1,
                },
                { onConflict: "user_id,vendor_pattern" },
              );
            if (prefError)
              logError("Failed to save vendor preference", prefError);
          }

          // Mark inbox item as acted
          await supabase
            .from("inbox_items")
            .update({ status: "acted", acted_at: new Date().toISOString() })
            .eq("id", item.id);

          toast.success(
            isMedical ? "Marked as medical expense" : "Marked as not medical",
          );
        } else if (item.item_type === "confirm_match") {
          const sa = item.suggested_action;
          if (!sa || sa.action !== "link") return;

          const transactionId = sa.transaction_id as string;
          const invoiceId = sa.invoice_id as string;

          // Create payment_transaction to link them
          const { error: paymentError } = await supabase
            .from("payment_transactions")
            .insert({
              invoice_id: invoiceId,
              transaction_id: transactionId,
              user_id: user.id,
              payment_date: new Date().toISOString().split("T")[0],
              amount: item.amount || 0,
              payment_source: "out_of_pocket",
              notes: "Confirmed from attention queue",
            });

          if (paymentError) throw paymentError;

          // Update transaction status
          const { error: txnError } = await supabase
            .from("transactions")
            .update({
              invoice_id: invoiceId,
              reconciliation_status: "linked_to_invoice",
            })
            .eq("id", transactionId);

          if (txnError) throw txnError;

          // Mark inbox item as acted
          await supabase
            .from("inbox_items")
            .update({ status: "acted", acted_at: new Date().toISOString() })
            .eq("id", item.id);

          toast.success("Match confirmed — transaction linked to bill");
        }

        invalidateQueries();
      } catch (error) {
        logError("Error acting on inbox item", error);
        toast.error("Failed to process item");
      }
    },
    [invalidateQueries],
  );

  const dismissItem = useCallback(
    async (item: InboxItem) => {
      if (item.isVirtual) return;

      try {
        const { error } = await supabase
          .from("inbox_items")
          .update({
            status: "dismissed",
            acted_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        if (error) throw error;

        toast.success("Item dismissed");
        invalidateQueries();
      } catch (error) {
        logError("Error dismissing inbox item", error);
        toast.error("Failed to dismiss item");
      }
    },
    [invalidateQueries],
  );

  const batchAct = useCallback(
    async (items: InboxItem[], action: string) => {
      for (const item of items) {
        await actOnItem(item, action);
      }
    },
    [actOnItem],
  );

  const batchDismiss = useCallback(
    async (items: InboxItem[]) => {
      const dbItems = items.filter((i) => !i.isVirtual);
      if (dbItems.length === 0) return;

      try {
        const { error } = await supabase
          .from("inbox_items")
          .update({
            status: "dismissed",
            acted_at: new Date().toISOString(),
          })
          .in(
            "id",
            dbItems.map((i) => i.id),
          );

        if (error) throw error;

        toast.success(`${dbItems.length} items dismissed`);
        invalidateQueries();
      } catch (error) {
        logError("Error batch dismissing", error);
        toast.error("Failed to dismiss items");
      }
    },
    [invalidateQueries],
  );

  return {
    items: data || [],
    isLoading,
    actOnItem,
    dismissItem,
    batchAct,
    batchDismiss,
    refetch: () => refetch(),
  };
}
