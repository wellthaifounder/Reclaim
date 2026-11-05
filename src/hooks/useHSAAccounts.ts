import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { HSAAccount } from "@/lib/hsaAccountUtils";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useHSA } from "@/contexts/HSAContext";
import {
  describeTimingRecompute,
  useRecomputeTiming,
} from "@/hooks/useHSAEligibility";

// Every column of HSAAccount, named rather than `*` (CLAUDE.md).
const COLUMNS =
  "id, user_id, account_name, opened_date, closed_date, is_active, created_at, updated_at, eligibility_start_date, qle_type, notes";

export function useHSAAccounts() {
  const queryClient = useQueryClient();
  const { user } = useAuthUser();
  const userId = user?.id;
  const recomputeTiming = useRecomputeTiming();
  const { refreshHSAStatus } = useHSA();

  // Fetch all HSA accounts for the current user
  const {
    data: accounts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["hsa-accounts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hsa_accounts")
        .select(COLUMNS)
        .eq("user_id", userId!)
        .order("opened_date", { ascending: false });

      if (error) throw error;
      return data as HSAAccount[];
    },
  });

  // L2: one HSA opening date. Adding, editing or deleting an account moves
  // profiles.hsa_opened_date to the earliest date across the user's accounts
  // -- a database trigger does that in the same write
  // (20261104085017_one_hsa_opening_date.sql). What the trigger cannot do is
  // re-run the timing rule over the user's expenses, because that function
  // only accepts the signed-in owner; so it happens here, exactly as it does
  // after onboarding or the HSA-date dialog saves a date.
  const afterSave = async (lead: string) => {
    queryClient.invalidateQueries({ queryKey: ["hsa-accounts"] });
    // HSAContext reads the profile's date once per sign-in; without this a
    // first HSA date added here left "has an HSA" false on BillDetail and in
    // the sidebar until a reload.
    void refreshHSAStatus();
    try {
      // Also refreshes the establishment date and the setup checklist.
      const result = await recomputeTiming.mutateAsync();
      toast.success(describeTimingRecompute(lead, result));
    } catch {
      // Logged inside the hook. The account and the date both saved; the
      // recompute runs again on the next date change.
      queryClient.invalidateQueries({ queryKey: ["hsa-establishment-date"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      toast.success(`${lead}.`);
    }
  };

  // Create a new HSA account
  const createAccount = useMutation({
    mutationFn: async (
      account: Omit<HSAAccount, "id" | "user_id" | "created_at" | "updated_at">,
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("hsa_accounts")
        .insert({
          ...account,
          user_id: user.id,
        })
        .select(COLUMNS)
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => afterSave("HSA account created"),
    onError: (error) => {
      logError("Error creating HSA account", error);
      toast.error("Failed to create HSA account");
    },
  });

  // Update an existing HSA account
  const updateAccount = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<HSAAccount>;
    }) => {
      const { data, error } = await supabase
        .from("hsa_accounts")
        .update(updates)
        .eq("id", id)
        .select(COLUMNS)
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => afterSave("HSA account updated"),
    onError: (error) => {
      logError("Error updating HSA account", error);
      toast.error("Failed to update HSA account");
    },
  });

  // Delete an HSA account
  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hsa_accounts")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => afterSave("HSA account deleted"),
    onError: (error) => {
      logError("Error deleting HSA account", error);
      toast.error("Failed to delete HSA account");
    },
  });

  return {
    accounts,
    isLoading,
    error,
    createAccount: createAccount.mutateAsync,
    updateAccount: updateAccount.mutateAsync,
    deleteAccount: deleteAccount.mutateAsync,
    isCreating: createAccount.isPending,
    isUpdating: updateAccount.isPending,
    isDeleting: deleteAccount.isPending,
  };
}
