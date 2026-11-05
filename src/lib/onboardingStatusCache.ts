// The cached answer to "has this person finished setup?", and the one safe way
// to change it.
//
// Lives apart from useOnboardingStatus.ts (which imports the Supabase client
// through the "@/" alias) so `npm test` can exercise it under plain Node.

import type { QueryClient } from "@tanstack/react-query";

/** What useOnboardingStatus caches per user. */
export interface OnboardingStatusData {
  completedAt: string | null;
  hsaDate: string | null;
  estimate: boolean;
  hasBank: boolean;
}

export const onboardingStatusKey = (userId: string | undefined) =>
  ["onboarding-status", userId] as const;

/**
 * Record that setup was finished (or reopened) in the cache, before anything
 * navigates on the strength of it.
 *
 * Setup used to loop (V1 launch plan, Batch 1, problem 1). Finishing only
 * marked this cache entry stale, and nothing on /welcome watches it, so
 * nothing refetched. The dashboard then mounted, read the copy saved on the
 * user's first visit -- "not finished" -- and sent them straight back to
 * /welcome. Anyone who finished within the cache's five-minute lifetime was
 * caught; slower users escaped, which is why skipping sometimes seemed to work.
 *
 * So the new answer is written in, not merely flagged as stale:
 *
 *  1. Cancel any fetch already in flight. It was sent before the save landed
 *     and would overwrite the new answer with the old one when it returns.
 *  2. Write the answer into the cached copy, if there is one. If there is
 *     not, the next reader fetches from the database, which is already right.
 *  3. Mark it stale anyway, so the next reader confirms it against the
 *     database in the background.
 */
export async function recordOnboardingCompletion(
  queryClient: QueryClient,
  userId: string,
  completedAt: string | null,
): Promise<void> {
  const key = onboardingStatusKey(userId);
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<OnboardingStatusData>(key, (old) =>
    old ? { ...old, completedAt } : old,
  );
  await queryClient.invalidateQueries({ queryKey: key });
}
