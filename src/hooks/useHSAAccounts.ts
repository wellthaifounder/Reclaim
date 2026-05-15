import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { HSAAccount } from "@/lib/hsaAccountUtils";
import { logError } from "@/utils/errorHandler";
import { useAuthUser } from "@/hooks/useAuthUser";

export function useHSAAccounts() {
  const queryClient = useQueryClient();
  const { user } = useAuthUser();
  const userId = user?.id;

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
        .select("*")
        .eq("user_id", userId!)
        .order("opened_date", { ascending: false });

      if (error) throw error;
      return data as HSAAccount[];
    },
  });

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
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hsa-accounts"] });
      toast.success("HSA account created successfully");
    },
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
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hsa-accounts"] });
      toast.success("HSA account updated successfully");
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hsa-accounts"] });
      toast.success("HSA account deleted successfully");
    },
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
