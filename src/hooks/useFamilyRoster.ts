// Workstream D1 — the family roster.
//
// Replaces free-text `patient_name` with real people, each carrying the one
// fact that decides whether HSA money may pay for their care: whether they are
// claimed as a tax dependent.
//
// The distinction this exists for: an adult child can be on your health plan
// to age 26 and not be your tax dependent. Coverage and dependency are
// different things, and only dependency makes their medical expenses
// HSA-eligible. Getting it wrong is a costly and common mistake.
//
// `tax_dependent` is three-valued here — true / false / null-for-unasked — and
// the UI must keep it that way. Defaulting an unanswered question to "yes"
// automates the trap; defaulting it to "no" quietly destroys money the user is
// entitled to claim.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

export type FamilyRelationship =
  "self" | "spouse" | "child" | "other_dependent";

export interface FamilyMember {
  id: string;
  name: string;
  relationship: FamilyRelationship;
  /** null means we have not asked. Never coerce it to false. */
  tax_dependent: boolean | null;
  date_of_birth: string | null;
  notes: string | null;
  is_active: boolean;
  /** Gate 2, computed in the database. null = unresolved. */
  qualifies_for_hsa: boolean | null;
}

const COLUMNS =
  "id, name, relationship, tax_dependent, date_of_birth, notes, is_active, qualifies_for_hsa";

export const RELATIONSHIP_LABELS: Record<FamilyRelationship, string> = {
  self: "Me",
  spouse: "Spouse",
  child: "Child",
  other_dependent: "Other dependent",
};

/**
 * Whether the tax-dependent question is worth asking for this relationship.
 *
 * Never for the account holder or their spouse — Publication 969 covers a
 * spouse whether or not you claim them, so asking would imply their answer
 * could make their care ineligible, which is wrong and alarming.
 */
export function needsDependencyAnswer(m: FamilyMember): boolean {
  return (
    m.relationship !== "self" &&
    m.relationship !== "spouse" &&
    m.tax_dependent === null
  );
}

/** One-line status for a roster row. */
export function memberEligibilitySummary(m: FamilyMember): {
  tone: "ok" | "warn" | "blocked";
  text: string;
} {
  if (m.relationship === "self") {
    return { tone: "ok", text: "Your own expenses always qualify" };
  }
  if (m.relationship === "spouse") {
    return { tone: "ok", text: "A spouse's expenses always qualify" };
  }
  if (m.tax_dependent === true) {
    return { tone: "ok", text: "Tax dependent — expenses qualify" };
  }
  if (m.tax_dependent === false) {
    return {
      tone: "blocked",
      text: "Not a tax dependent — expenses don't qualify",
    };
  }
  return {
    tone: "warn",
    text: "We need to know if you claim them on your taxes",
  };
}

export function useFamilyRoster() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["family-roster"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<FamilyMember[]> => {
      const { data, error } = await supabase
        .from("family_members")
        .select(COLUMNS)
        .eq("is_active", true)
        .order("relationship")
        .order("name");
      if (error) throw error;
      return (data ?? []) as FamilyMember[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["family-roster"] });
    // Renaming a member rewrites patient_name on their expenses via trigger,
    // so anything displaying an expense is now stale.
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
  };

  const addMember = useMutation({
    mutationFn: async (input: {
      name: string;
      relationship: FamilyRelationship;
      taxDependent?: boolean | null;
      dateOfBirth?: string | null;
    }): Promise<FamilyMember> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in.");

      const { data, error } = await supabase
        .from("family_members")
        .insert({
          user_id: user.id,
          name: input.name.trim(),
          relationship: input.relationship,
          // Undefined stays null: an unanswered dependency question must
          // remain unanswered rather than being decided by the default.
          tax_dependent: input.taxDependent ?? null,
          date_of_birth: input.dateOfBirth ?? null,
        })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return data as FamilyMember;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Adding a family member failed", error),
  });

  const updateMember = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      relationship?: FamilyRelationship;
      taxDependent?: boolean | null;
      dateOfBirth?: string | null;
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.relationship !== undefined)
        patch.relationship = input.relationship;
      if (input.taxDependent !== undefined)
        patch.tax_dependent = input.taxDependent;
      if (input.dateOfBirth !== undefined)
        patch.date_of_birth = input.dateOfBirth;

      const { error } = await supabase
        .from("family_members")
        .update(patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Updating a family member failed", error),
  });

  /**
   * Remove someone from the roster.
   *
   * Their expenses are NOT deleted — the foreign key sets patient_id to null
   * and the recorded name survives, so medical history stays intact and the
   * expenses simply become unassigned. Anyone taking this action is tidying a
   * list, not asking to erase a person's records.
   */
  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("family_members")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => logError("Removing a family member failed", error),
  });

  const members = query.data ?? [];

  return {
    members,
    self: members.find((m) => m.relationship === "self") ?? null,
    /** People whose dependency status is still unanswered — a real blocker. */
    unresolved: members.filter(needsDependencyAnswer),
    isLoading: query.isLoading,
    error: query.error,
    addMember,
    updateMember,
    removeMember,
    refetch: query.refetch,
  };
}
