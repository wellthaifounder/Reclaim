// Lightweight cookie/consent banner for the Reclaim soft launch.
//
// The choice is non-sensitive UI state, so it lives in localStorage (allowed
// per CLAUDE.md — only auth tokens are barred from localStorage). The banner
// shows once until the user makes a choice; "Essential only" and "Accept all"
// both record consent and dismiss it. We don't load any non-essential trackers
// today, so the distinction is recorded for when analytics ships, not wired to
// a tag manager yet.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "reclaim_cookie_consent"; // "all" | "essential"

export const CookieConsent = () => {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage unavailable (private mode / blocked) — skip the banner.
    }
  }, []);

  // The banner stays `fixed` so it anchors to the viewport regardless of
  // which page layout is mounted under it -- but a fixed element is removed
  // from document flow, so nothing tells the page to leave room for it.
  // Every one of the 108 design-review screenshots showed it sitting on top
  // of something: "Continue with Google", a bank account card, a claim
  // record row, the field of a form mid-fill. Measuring the banner's real
  // height and padding the body by that amount moves the page's true bottom
  // edge up instead, so there is nothing left underneath for it to cover.
  // A ResizeObserver keeps this correct as the banner reflows (it wraps to
  // two lines on narrow phones, which changes its height).
  //
  // The mobile bottom tab bar (BottomTabNavigation) is *also* `fixed
  // bottom-0`, and this banner renders after it with a higher z-index --
  // so without the offset below, the banner sits directly on top of it and
  // the entire navigation bar disappears for as long as the banner is up.
  // Detecting it by its aria-label and sitting above it, rather than
  // hard-coding its height, means this still works if that bar's height
  // ever changes, and does nothing on pages that don't have one.
  useEffect(() => {
    if (!visible) return;
    const el = bannerRef.current;
    if (!el) return;

    const reposition = () => {
      const tabBar = document.querySelector<HTMLElement>(
        'nav[aria-label="Bottom navigation"]',
      );
      // Not `tabBar.offsetParent !== null` -- that check reads as "hidden"
      // for any `position: fixed` element regardless of whether it's
      // actually on screen, which the tab bar always is. `offsetHeight` is
      // already 0 for a `display: none` element (it's `lg:hidden`, so this
      // correctly becomes 0 on desktop), so it alone is the right check.
      const tabBarHeight = tabBar?.offsetHeight ?? 0;
      el.style.bottom = `${tabBarHeight}px`;
      document.body.style.paddingBottom = `${el.offsetHeight + tabBarHeight}px`;
    };
    reposition();

    const resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(el);
    window.addEventListener("resize", reposition);

    // The tab bar frequently doesn't exist yet the first time this runs --
    // ProtectedRoute resolves the auth check (an async Supabase call) before
    // it renders the page underneath, and this banner's own visibility is
    // decided by a synchronous localStorage read that wins that race. A
    // ResizeObserver on the banner alone never re-fires for that, since the
    // banner itself hasn't changed size -- only watching the DOM for the tab
    // bar actually appearing (or disappearing, e.g. navigating to a page
    // that doesn't have one) catches it.
    const mutationObserver = new MutationObserver(reposition);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", reposition);
      el.style.bottom = "";
      document.body.style.paddingBottom = "";
    };
  }, [visible]);

  const choose = (value: "all" | "essential") => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore persistence failures; banner still dismisses for this session
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      ref={bannerRef}
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="container mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use essential cookies to run Reclaim and keep you signed in. With
          your consent we may also use cookies to understand usage and improve
          the product. See our{" "}
          <a href="/privacy" className="text-primary underline">
            Privacy Policy
          </a>
          .
        </p>
        {/* Same variant and size on both buttons -- a real decline should
            never be styled as the lesser option next to a highlighted
            accept. `outline` also keeps this from matching whatever primary
            action the page underneath is using (e.g. Sign In), which is what
            made "Accept all" read as the loudest thing on the sign-in
            screen. `lg` is the app's 44px-tall size; full width on mobile
            keeps that without the two buttons risking overflow side by side
            on a narrow phone. */}
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => choose("essential")}
          >
            Essential only
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => choose("all")}
          >
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
};
