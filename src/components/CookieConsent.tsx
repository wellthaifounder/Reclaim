// Lightweight cookie/consent banner for the Reclaim soft launch.
//
// The choice is non-sensitive UI state, so it lives in localStorage (allowed
// per CLAUDE.md — only auth tokens are barred from localStorage). The banner
// shows once until the user makes a choice; "Essential only" and "Accept all"
// both record consent and dismiss it. We don't load any non-essential trackers
// today, so the distinction is recorded for when analytics ships, not wired to
// a tag manager yet.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "reclaim_cookie_consent"; // "all" | "essential"

export const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage unavailable (private mode / blocked) — skip the banner.
    }
  }, []);

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
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => choose("essential")}
          >
            Essential only
          </Button>
          <Button size="sm" onClick={() => choose("all")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
};
