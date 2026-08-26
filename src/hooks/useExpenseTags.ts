// Workstream D5 — tags.
//
// The spec's organisation model is "tags + rich filters + saved views +
// search. No folder tree." The job is retrieval under stress — "everything for
// Maya in 2025 that isn't reimbursed yet" — which is a filter. A single
// hierarchy would force that query to be a misfile.
//
// Tags are case-insensitive at the database level. Without that, "Dental" and
// "dental" become two tags and the filter the feature exists for silently
// returns half the expenses.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

export interface Tag {
  id: string;
  name: string;
}

/** Every tag the user has, for autocomplete. */
export function useAllTags() {
  const query = useQuery({
    queryKey: ["tags"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
  });
  return { tags: query.data ?? [], isLoading: query.isLoading };
}

export function useExpenseTags(invoiceId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["expense-tags", invoiceId],
    enabled: !!invoiceId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from("expense_tags")
        .select("tags(id, name)")
        .eq("invoice_id", invoiceId!);
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.tags as Tag | null)
        .filter((t): t is Tag => t !== null);
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-tags", invoiceId] });
    queryClient.invalidateQueries({ queryKey: ["tags"] });
  };

  /**
   * Attach a tag, creating it if this is its first use.
   *
   * Reuses an existing tag whose name matches case-insensitively rather than
   * letting the unique index reject the insert — typing "dental" when "Dental"
   * exists should quietly attach the one that exists, not fail.
   */
  const addTag = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !invoiceId) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in.");

      const { data: existing } = await supabase
        .from("tags")
        .select("id")
        .ilike("name", trimmed)
        .maybeSingle();

      let tagId = existing?.id;
      if (!tagId) {
        const { data: created, error: createErr } = await supabase
          .from("tags")
          .insert({ user_id: user.id, name: trimmed })
          .select("id")
          .single();
        if (createErr) throw createErr;
        tagId = created.id;
      }

      const { error } = await supabase
        .from("expense_tags")
        .insert({ invoice_id: invoiceId, tag_id: tagId, user_id: user.id });
      // Already attached is not an error worth surfacing — the user's intent
      // is satisfied either way.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Adding a tag failed", error),
  });

  /**
   * Detach a tag from this expense.
   *
   * Leaves the tag itself alone: removing "Surgery" from one expense must not
   * remove it from every other expense that uses it.
   */
  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      if (!invoiceId) return;
      const { error } = await supabase
        .from("expense_tags")
        .delete()
        .eq("invoice_id", invoiceId)
        .eq("tag_id", tagId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Removing a tag failed", error),
  });

  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    addTag,
    removeTag,
  };
}

export interface SubstantiationStatus {
  is_complete: boolean;
  missing: string[];
  document_count: number;
  has_service_date: boolean;
  has_patient: boolean;
  blocking_gate: string | null;
}

/** What this expense still needs before it can be claimed. */
export function useSubstantiationStatus(invoiceId: string | null) {
  const query = useQuery({
    queryKey: ["substantiation-status", invoiceId],
    enabled: !!invoiceId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<SubstantiationStatus | null> => {
      const { data, error } = await supabase.rpc(
        "expense_substantiation_status",
        { p_invoice_id: invoiceId! },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as SubstantiationStatus) ?? null;
    },
  });
  return { status: query.data ?? null, isLoading: query.isLoading };
}
