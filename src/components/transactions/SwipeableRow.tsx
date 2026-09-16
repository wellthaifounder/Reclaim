// Spec D35 — swipe right for healthcare, left to dismiss.
//
// Purely additive (grilling round, Q1): the Healthcare / Not healthcare /
// Split buttons this wraps are untouched and stay the accessible, keyboard-
// and mouse-reachable path on every device. This is a touch-only shortcut
// layered on top, gated by FF.SWIPE_TO_TRIAGE, and it never fires for a
// mouse-originated pointer (Q6) -- desktop is unaffected, drag or not.
//
// Hand-rolled on native Pointer Events rather than a dependency: this repo
// has no gesture library installed, and a two-direction drag-to-commit is a
// small enough state machine that adding one would be pure extra weight for
// a bundle the build already flags as oversized.
//
// touch-action: pan-y (not JS) is what lets a vertical scroll on the review
// list pass through untouched while a horizontal drag is captured here --
// the platform decides which gesture wins based on the CSS, not a hand-rolled
// direction heuristic that would race the browser's own scroll handling.

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fraction of the row's own width a drag must cross before it commits. */
const COMMIT_FRACTION = 0.375;
/** Below this many px of movement, a release is a tap, not an aborted swipe. */
const TAP_MOVE_PX = 6;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface SwipeableRowProps {
  children: ReactNode;
  /** Right swipe. Omit to disable that direction entirely -- mirrors
   *  whichever buttons this row actually offers (grilling Q3: no
   *  special-casing beyond what the buttons already do). */
  onConfirm?: () => void;
  /** Left swipe. Same omission rule as onConfirm. */
  onDismiss?: () => void;
  /** A tap that wasn't a drag: reveals the same detail a swipe can't carry
   *  (Split doesn't fit in a two-direction gesture). */
  onTap: () => void;
  /** FF.SWIPE_TO_TRIAGE. When false, renders children completely unwrapped
   *  -- no handlers, no reveal layers, nothing to disable per-row. */
  enabled: boolean;
  /** Busy / leaving-animation state from the parent; suppresses new drags
   *  without needing this component to know why. */
  disabled?: boolean;
  /** True for exactly one row per queue visit -- see useSwipeCoachMark. */
  showCoachMark?: boolean;
  /** Fired once the coach mark's demo has played through, or the instant a
   *  real drag starts (grilling Q5: whichever comes first). */
  onCoachMarkDone?: () => void;
  className?: string;
}

export function SwipeableRow({
  children,
  onConfirm,
  onDismiss,
  onTap,
  enabled,
  disabled = false,
  showCoachMark = false,
  onCoachMarkDone,
  className,
}: SwipeableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(1);
  const startRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const dragXRef = useRef(0);
  const demoTimeouts = useRef<number[]>([]);

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [demoPlaying, setDemoPlaying] = useState(false);

  const setDrag = (value: number) => {
    dragXRef.current = value;
    setDragX(value);
  };

  const clearDemo = () => {
    demoTimeouts.current.forEach((id) => window.clearTimeout(id));
    demoTimeouts.current = [];
  };

  // The coach mark: nudge right (reveal, hold, spring back), then left, then
  // hand off. Skipped entirely under reduced motion -- the caption alone
  // teaches the same thing without the animation prefers-reduced-motion asks
  // this app not to play.
  useEffect(() => {
    if (!enabled || !showCoachMark || disabled) return;
    if (prefersReducedMotion()) {
      const id = window.setTimeout(() => onCoachMarkDone?.(), 3000);
      demoTimeouts.current.push(id);
      return () => clearDemo();
    }

    setDemoPlaying(true);
    const width = containerRef.current?.getBoundingClientRect().width || 320;
    const nudge = Math.min(96, width * 0.28);
    const step = (delay: number, fn: () => void) =>
      demoTimeouts.current.push(window.setTimeout(fn, delay));

    step(500, () => onConfirm && setDrag(nudge));
    step(1000, () => setDrag(0));
    step(1500, () => onDismiss && setDrag(-nudge));
    step(2000, () => setDrag(0));
    step(2500, () => {
      setDemoPlaying(false);
      onCoachMarkDone?.();
    });

    return () => clearDemo();
    // Deliberately not exhaustive: this should run once for the one row that
    // claims the coach mark, not replay every time an inline onConfirm /
    // onDismiss / onCoachMarkDone closure gets a new identity on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, showCoachMark, disabled]);

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.pointerType === "mouse") return;
    // The row's own Healthcare/Not healthcare/Split buttons (and the overflow
    // menu) live inside this same wrapper, and pointer events bubble up to
    // it same as any other. Starting to track a drag/tap here on top of a
    // button press would fire both the button's own click AND this row's tap
    // (opening detail) or, worse, hijack the press into a drag. Bailing out
    // before touching pointer capture leaves the button's native behavior
    // completely undisturbed.
    if ((e.target as HTMLElement).closest("button, a, [role='menuitem']")) {
      return;
    }
    if (demoPlaying) {
      clearDemo();
      setDemoPlaying(false);
      onCoachMarkDone?.();
    }
    widthRef.current = containerRef.current?.getBoundingClientRect().width || 1;
    startRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    movedRef.current = false;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safari and some Android WebViews can throw here (capture already
      // released, or a rapid second touch) even for a pointer that is, in
      // fact, still down. Capture is an optimization -- move/up handlers
      // still work without it as long as the same finger stays over this
      // element -- so a failure here shouldn't abort the gesture.
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    let dx = e.clientX - startRef.current.x;
    if (dx > 0 && !onConfirm) dx = 0;
    if (dx < 0 && !onDismiss) dx = 0;
    dx = Math.max(-widthRef.current, Math.min(widthRef.current, dx));
    if (Math.abs(e.clientX - startRef.current.x) > TAP_MOVE_PX) {
      movedRef.current = true;
    }
    setDrag(dx);
  };

  const endDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    /** True for a real pointerup, false for a pointercancel (the OS
     *  interrupted the gesture -- never a tap, never a commit). */
    committed: boolean,
  ) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setDragging(false);

    if (!movedRef.current) {
      setDrag(0);
      if (committed) onTap();
      return;
    }
    if (!committed) {
      setDrag(0);
      return;
    }

    const threshold = widthRef.current * COMMIT_FRACTION;
    if (dragXRef.current > threshold && onConfirm) {
      setDrag(widthRef.current);
      onConfirm();
    } else if (dragXRef.current < -threshold && onDismiss) {
      setDrag(-widthRef.current);
      onDismiss();
    } else {
      setDrag(0);
    }
  };

  const revealOpacity = (side: "right" | "left") => {
    const threshold = widthRef.current * COMMIT_FRACTION || 1;
    const raw = side === "right" ? dragX : -dragX;
    return Math.max(0, Math.min(1, raw / threshold));
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={{ touchAction: "pan-y" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      {onConfirm && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center gap-1.5 rounded-lg bg-emerald-100 px-4 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          style={{ opacity: revealOpacity("right") }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Healthcare
        </div>
      )}
      {onDismiss && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-lg bg-muted px-4 font-medium text-muted-foreground"
          style={{ opacity: revealOpacity("left") }}
        >
          Not healthcare
          <XCircle className="h-4 w-4 shrink-0" />
        </div>
      )}
      <div
        className="relative bg-background"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
        }}
      >
        {children}
      </div>
      {demoPlaying && (
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-3 py-1 text-xs text-background shadow-md"
        >
          Swipe to decide, or tap for details
        </div>
      )}
    </div>
  );
}
