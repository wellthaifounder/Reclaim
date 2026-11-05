// The shared signed-in user, and what happens to everything else in the cache
// when that user changes.
//
// Kept apart from useAuthUser.ts (which imports the Supabase client through
// the "@/" alias) so `npm test` can run it under plain Node.

import type { QueryClient } from "@tanstack/react-query";

export const AUTH_USER_KEY = ["auth-user"] as const;

/**
 * Returns the handler for Supabase auth events: call it with the session's
 * user (or null) on every event.
 *
 * It writes that user into the shared cache at once (see bindAuthUserCache
 * for why), and when the person changes -- sign-out, or a different person
 * signing in -- it first drops every other cached query.
 *
 * Several queries are not keyed by user id (the family roster, the document
 * library, tags, duplicate candidates, categorisation rules), because row-level
 * security already scopes what they fetch. On a shared computer that meant the
 * next person to sign in within the five-minute cache saw the previous
 * person's family and document names -- health information -- until a
 * refetch. Clearing on a change of person closes that for every such query,
 * including ones written later.
 *
 * Same-person events (the hourly token refresh, profile updates) clear
 * nothing. The first event after the page loads only records who is signed
 * in: nothing from anyone else can be cached yet.
 */
export function createAuthUserCacheSync<U extends { id: string }>(
  queryClient: QueryClient,
): (user: U | null) => void {
  // undefined: no auth event seen yet on this page.
  let lastUserId: string | null | undefined;

  return (user) => {
    const userId = user?.id ?? null;
    if (lastUserId !== undefined && userId !== lastUserId) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== AUTH_USER_KEY[0],
      });
    }
    lastUserId = userId;
    queryClient.setQueryData<U | null>(AUTH_USER_KEY, user);
  };
}
