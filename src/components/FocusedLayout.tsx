// A deliberately bare layout for setup, and the documented exception to
// "authenticated pages use AuthenticatedLayout".
//
// The general rule exists because a page without that layout loses its
// navigation on mobile, and this codebase has shipped stranded pages before.
// Step 0 is where the rule inverts: a brand-new account has no expenses, no
// records and nothing to substantiate, so the full chrome offers six doors
// into empty rooms at the exact moment we are asking for their trust and
// their bank credentials. The gold "Snap a receipt" button in the top bar is
// worse than empty -- it is a competing call to action pointing at manual
// entry, on the screen whose whole job is to argue for connecting a bank.
//
// So: logo, the flow, a theme toggle, and one always-visible way out. The way
// out is not optional. Chrome-free must never mean trapped, and an escape
// hatch the user can see is what separates a focused flow from a dead end.
//
// Session timeout stays. It is a security control, not chrome.

import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";

interface FocusedLayoutProps {
  children: ReactNode;
  /** Label for the escape hatch. */
  exitLabel?: string;
  /** Where the escape hatch goes. Omit to hide it — use only where the page
   *  itself already renders a clearly-visible way onward. */
  onExit?: () => void;
}

export const FocusedLayout = ({
  children,
  exitLabel = "Skip for now",
  onExit,
}: FocusedLayoutProps) => {
  useSessionTimeout(15, 2);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between px-4 sm:px-6 py-4">
        {/* Not a link. Clicking the logo out of a half-finished setup is the
            accidental exit this layout exists to prevent; the button on the
            right is the deliberate one. */}
        <ReclaimLogo size="sm" />

        <div className="flex items-center gap-1">
          <ThemeToggle />
          {onExit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onExit}
              className="text-muted-foreground"
            >
              {exitLabel}
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full">{children}</main>

      <footer className="px-4 py-6 text-center">
        <button
          type="button"
          onClick={() => navigate("/privacy")}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Privacy Policy
        </button>
      </footer>
    </div>
  );
};
