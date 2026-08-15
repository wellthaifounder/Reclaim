// Workstream C3 — categorization rules data layer.
//
// Replaces the silent writes to `user_vendor_preferences`, which had no read
// path in the UI at all: a mislabelled vendor could not be listed, edited or
// undone.
//
// Retroactive apply and undo run as SECURITY DEFINER RPCs rather than client
// updates, because they also write the `rule_applications` audit log, which has
// no INSERT policy. Doing it client-side would either require opening that log
// to writes — destroying its value as an audit trail — or give up undo.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import type { RuleMatchType } from "@/lib/merchantNormalize";

export interface CategorizationRule {
  id: string;
  user_id: string;
  match_type: RuleMatchType;
  match_value: string;
  is_medical: boolean;
  display_label: string | null;
  created_at: string;
  updated_at: string;
}

/** A rule plus how many transactions it currently governs. */
export interface CategorizationRuleWithImpact extends CategorizationRule {
  affectedCount: number;
}

const RULE_COLUMNS =
  "id, user_id, match_type, match_value, is_medical, display_label, created_at, updated_at";

export function useCategorizationRules() {
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: ["categorization-rules"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CategorizationRuleWithImpact[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: rules, error } = await supabase
        .from("categorization_rules")
        .select(RULE_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!rules || rules.length === 0) return [];

      // One batched query for provenance rather than one per rule — the
      // management screen would otherwise fire N+1 requests on every render.
      const { data: governed, error: govError } = await supabase
        .from("transactions")
        .select("applied_by_rule_id")
        .eq("user_id", user.id)
        .in(
          "applied_by_rule_id",
          rules.map((r) => r.id),
        );
      if (govError) throw govError;

      const counts = new Map<string, number>();
      for (const row of governed ?? []) {
        const id = row.applied_by_rule_id;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }

      return rules.map((r) => ({
        ...(r as CategorizationRule),
        affectedCount: counts.get(r.id) ?? 0,
      }));
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
    // Rules rewrite is_medical and needs_review, so anything reading
    // transactions is now stale.
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
  };

  /**
   * How many existing transactions a rule would touch. Drives the
   * "apply to 47 past transactions?" prompt, so it must use the same matching
   * predicate as the apply itself — hence the shared SQL function rather than a
   * client-side count.
   */
  const previewImpact = async (
    matchType: RuleMatchType,
    matchValue: string,
  ): Promise<number> => {
    const { data, error } = await supabase.rpc("preview_categorization_rule", {
      p_match_type: matchType,
      p_match_value: matchValue,
    });
    if (error) throw error;
    return data ?? 0;
  };

  const createRule = useMutation({
    mutationFn: async (input: {
      matchType: RuleMatchType;
      matchValue: string;
      isMedical: boolean;
      displayLabel?: string | null;
      /** Apply to existing transactions as well as future ones. */
      applyRetroactively: boolean;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: rule, error } = await supabase
        .from("categorization_rules")
        .upsert(
          {
            user_id: user.id,
            match_type: input.matchType,
            match_value: input.matchValue,
            is_medical: input.isMedical,
            display_label: input.displayLabel ?? null,
          },
          { onConflict: "user_id,match_type,match_value" },
        )
        .select("id")
        .single();
      if (error) throw error;

      let applied = 0;
      if (input.applyRetroactively) {
        const { data, error: applyError } = await supabase.rpc(
          "apply_categorization_rule",
          { p_rule_id: rule.id },
        );
        if (applyError) throw applyError;
        applied = data ?? 0;
      }
      return { ruleId: rule.id as string, applied };
    },
    onSuccess: invalidate,
    onError: (error) => logError("Failed to create categorization rule", error),
  });

  const applyRule = useMutation({
    mutationFn: async (ruleId: string): Promise<number> => {
      const { data, error } = await supabase.rpc("apply_categorization_rule", {
        p_rule_id: ruleId,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Failed to apply categorization rule", error),
  });

  const revertRule = useMutation({
    mutationFn: async (ruleId: string): Promise<number> => {
      const { data, error } = await supabase.rpc("revert_categorization_rule", {
        p_rule_id: ruleId,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Failed to revert categorization rule", error),
  });

  const updateRule = useMutation({
    mutationFn: async (input: { id: string; isMedical: boolean }) => {
      // Flipping the verdict makes every past application wrong, so revert
      // first and re-apply under the new verdict. Updating in place would
      // leave already-categorized transactions holding the old answer with no
      // indication they disagree with the rule that supposedly governs them.
      const { error: revertError } = await supabase.rpc(
        "revert_categorization_rule",
        { p_rule_id: input.id },
      );
      if (revertError) throw revertError;

      const { error } = await supabase
        .from("categorization_rules")
        .update({ is_medical: input.isMedical })
        .eq("id", input.id);
      if (error) throw error;

      const { data, error: applyError } = await supabase.rpc(
        "apply_categorization_rule",
        { p_rule_id: input.id },
      );
      if (applyError) throw applyError;
      return data ?? 0;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Failed to update categorization rule", error),
  });

  const deleteRule = useMutation({
    mutationFn: async (ruleId: string) => {
      // Revert before deleting. rule_applications cascades on rule delete, so
      // dropping the rule first would take the undo history with it and strand
      // every transaction it touched at the rule's verdict, permanently.
      const { error: revertError } = await supabase.rpc(
        "revert_categorization_rule",
        { p_rule_id: ruleId },
      );
      if (revertError) throw revertError;

      const { error } = await supabase
        .from("categorization_rules")
        .delete()
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Failed to delete categorization rule", error),
  });

  return {
    rules: rulesQuery.data ?? [],
    isLoading: rulesQuery.isLoading,
    error: rulesQuery.error,
    previewImpact,
    createRule,
    applyRule,
    revertRule,
    updateRule,
    deleteRule,
  };
}
