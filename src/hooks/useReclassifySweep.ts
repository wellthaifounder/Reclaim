import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";

const SESSION_KEY = "reclassify-swept";

export interface ReclassifyResult {
  examined: number;
  queued: number;
  filed: number;
  unchanged: number;
  remaining: boolean;
}

/**
 * Spec D40's automatic half. Calls reclassify-transactions once per browser
 * session, so a classifier improvement reaches transactions someone imported
 * months ago instead of only the ones that arrive next.
 *
 * Firing on page mount rather than after a sync is deliberate: syncs only
 * happen when a user visits Bank Accounts or connects an account, so hanging
 * this off one would leave the people who most need it — anyone whose history
 * is already imported and who has no reason to sync again — never re-examined.
 *
 * Cheap when there is nothing to do: the function's own query is indexed on
 * (user_id, classifier_version) and returns `examined: 0` without writing.
 * The session flag is set before the call, not after, so an error does not
 * produce a retry loop on every re-render.
 */
export async function runReclassifySweep(): Promise<ReclassifyResult | null> {
  const { data, error } = await supabase.functions.invoke(
    "reclassify-transactions",
    { body: {} },
  );
  if (error) throw error;
  return (data as ReclassifyResult) ?? null;
}

export function useReclassifySweep(enabled: boolean) {
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;

    try {
      if (sessionStorage.getItem(SESSION_KEY) === "true") return;
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Private browsing or blocked storage: the sweep runs again next mount,
      // which is wasteful but harmless — it is idempotent by construction.
    }

    runReclassifySweep()
      .then((result) => {
        // Only disturb the screen when something actually moved. A sweep that
        // examined rows and changed nothing must not blink the queue.
        if (result && (result.queued > 0 || result.filed > 0)) {
          queryClient.invalidateQueries({ queryKey: ["review-feed"] });
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
          queryClient.invalidateQueries({ queryKey: ["attention-items"] });
        }
      })
      .catch((error) => {
        // Never user-facing. This is a background correctness pass; if it
        // fails the queue is simply as stale as it was a moment ago, and the
        // Settings button is the deliberate path.
        logError("Reclassify sweep failed", error);
      });
  }, [enabled, queryClient]);
}
