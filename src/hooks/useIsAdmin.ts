import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

export const useIsAdmin = () => {
  const { user, isLoading: userLoading } = useAuthUser();
  const userId = user?.id;

  const { data: isAdmin = false, isLoading: profileLoading } = useQuery({
    queryKey: ["is-admin", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId!)
        .single();
      return profile?.is_admin || false;
    },
    staleTime: 5 * 60 * 1000,
    meta: { suppressErrorToast: true },
  });

  return { isAdmin, loading: userLoading || (!!userId && profileLoading) };
};
