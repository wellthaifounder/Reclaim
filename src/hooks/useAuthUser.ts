import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_USER_KEY, createAuthUserCacheSync } from "@/lib/authUserCache";

// Shared auth-user query so components and hooks don't each hit /auth/v1/user
// on render. Audit (2026-05-14) found 6–8 redundant calls per page; sharing a
// single React Query collapses those to one network call until the cache
// expires.
export function useAuthUser() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: AUTH_USER_KEY,
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

/**
 * Keep the shared signed-in user current across sign-in and sign-out, and
 * clear everything else cached when the person changes. Call once, where the
 * QueryClient is created.
 *
 * Without it, signing in left the cache holding the answer fetched on the
 * sign-in page itself -- "nobody" -- for up to five minutes, because the
 * install card mounted at the app root asks for the user on every page,
 * /auth included. Every hook keyed on the user id sat disabled, so a brand-new
 * account signing in was never sent to setup at all: the setup check simply
 * never ran, and they landed on an empty dashboard with no checklist. Found
 * walking V1 launch plan Batch 1's "Done when" (signup through setup).
 *
 * The clearing half is in createAuthUserCacheSync: queries not keyed by user
 * otherwise showed the previous person's family and documents to the next
 * person to sign in on the same computer.
 */
export function bindAuthUserCache(queryClient: QueryClient) {
  const sync = createAuthUserCacheSync<User>(queryClient);
  supabase.auth.onAuthStateChange((_event, session) => {
    // Only cache work here: the Supabase client deadlocks if an auth callback
    // awaits another auth call.
    sync(session?.user ?? null);
  });
}
