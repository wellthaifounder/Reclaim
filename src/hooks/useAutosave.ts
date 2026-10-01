// Save a field as the person changes it (SUBSTANTIATE_SPEC S22).
//
// The substantiation fields used to have a Save button each, and a value typed
// without pressing it was lost when the dialog closed. Now a change is written
// shortly after the last keystroke, and anything still waiting is written the
// moment the field loses focus or the surface closes.
//
// The unmount flush is the point of the exercise: closing the dialog while the
// timer is running used to throw the edit away.

import { useCallback, useEffect, useRef } from "react";

export function useAutosave<T>(
  commit: (value: T) => Promise<unknown>,
  delayMs = 600,
) {
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Boxed so that a legitimately empty value ("" or null) still counts as pending.
  const pending = useRef<{ value: T } | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) void commitRef.current(next.value);
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  /** A newer value is rejected before it could be saved; drop the older one. */
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  const hasPending = useCallback(() => pending.current !== null, []);

  useEffect(() => flush, [flush]);

  return { schedule, flush, cancel, hasPending };
}
