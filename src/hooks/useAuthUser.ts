import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Shared auth-user query so components and hooks don't each hit /auth/v1/user
// on render. Audit (2026-05-14) found 6–8 redundant calls per page; sharing a
// single React Query collapses those to one network call until the cache
// expires.
export function useAuthUser() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return (user ?? null) as User | null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    meta: { suppressErrorToast: true },
  });

  return { user: data ?? null, isLoading, error, refetch };
}
