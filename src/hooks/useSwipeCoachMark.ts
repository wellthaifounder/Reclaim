import { useState } from "react";

const STORAGE_KEY = "review-swipe-coachmark-seen";

/**
 * Spec D35: the swipe coach mark shows once -- until the user's first real
 * swipe, or until it has played through once on its own, whichever comes
 * first -- and never again. Per-device by design (localStorage, not synced):
 * a second device or a cleared browser showing it again once is a fine
 * tradeoff for a coach mark, and this repo already reserves localStorage for
 * exactly this kind of per-viewer convenience rather than authoritative state.
 */
export function useSwipeCoachMark(): [boolean, () => void] {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const markSeen = () => {
    setSeen(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Private browsing / blocked storage: the coach mark just replays
      // next time, which is harmless.
    }
  };

  return [seen, markSeen];
}
