import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { ThemeToggle, ThemeToggleGroup } from "@/components/ThemeToggle";
import {
  LogOut,
  Receipt,
  FileText,
  Menu,
  Settings,
  LayoutDashboard,
  Building2,
  HelpCircle,
  Camera,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WellbieAvatar } from "@/components/WellbieAvatar";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { OnboardingProgressBar } from "@/components/onboarding/OnboardingProgressBar";
import { FF } from "@/lib/featureFlags";

interface AuthenticatedNavProps {
  unreviewedTransactions?: number;
  pendingReviews?: number;
}

// Shared so every nav list has the optional badge in its type. Without it,
// TypeScript infers the badge away from any list that happens not to use one,
// and the shared render code stops compiling.
interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: number;
}

export const AuthenticatedNav = ({
  unreviewedTransactions = 0,
  pendingReviews = 0,
}: AuthenticatedNavProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Error signing out");
    } else {
      toast.success("Signed out successfully");
    }
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  // Reclaim Phase 5 W1 — primary nav. Top-bar uses the BottomTabNavigation's
  // short labels (Groups / Records) so all 4 fit at lg breakpoints without
  // truncating. The sidebar + mobile hamburger keep the longer names.
  //
  // Both counts land on Expenses now that it is one page: transactions waiting
  // to be categorised are its Review tab, expenses waiting on eligibility are
  // its To-claim tab. Two badges on one destination would just ask the user to
  // do arithmetic, so they are summed -- the number means "things on this page
  // that want you".
  const expensesBadge = unreviewedTransactions + pendingReviews;

  const mainNavItems: NavItem[] = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    {
      icon: Receipt,
      label: "Expenses",
      path: "/expenses",
      badge: expensesBadge,
    },
    { icon: FileText, label: "Records", path: "/substantiation" },
  ];

  // Mobile hamburger sheet — has drawer space for full names.
  const coreItems: NavItem[] = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    {
      icon: Receipt,
      label: "Expenses",
      path: "/expenses",
      badge: expensesBadge,
    },
    { icon: FileText, label: "Substantiation", path: "/substantiation" },
  ];

  const moreItems: NavItem[] = [
    { icon: Building2, label: "Bank Accounts", path: "/bank-accounts" },
    { icon: FileText, label: "Documents", path: "/documents" },
    { icon: HelpCircle, label: "HSA Guide", path: "/guide" },
  ];

  const isActivePath = (path: string) => {
    if (path === "/dashboard") return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <>
      <nav
        className="border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-40 shadow-sm"
        aria-label="Main navigation"
      >
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <button
                onClick={() => navigate("/dashboard")}
                className="flex-shrink-0 hover:opacity-80 transition-opacity"
                aria-label="Go to dashboard"
              >
                <ReclaimLogo
                  size="sm"
                  showTagline
                  className="hidden sm:block"
                />
                <ReclaimLogo variant="icon" size="sm" className="sm:hidden" />
              </button>

              {/* Desktop Navigation Links - hidden on mobile */}
              <div
                className="hidden lg:flex items-center gap-1"
                role="navigation"
              >
                {mainNavItems.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      "relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
                      isActivePath(item.path)
                        ? "text-primary bg-accent"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                    aria-label={item.label}
                    aria-current={isActivePath(item.path) ? "page" : undefined}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    {/* Guard with `> 0` so a literal 0 doesn't render via React's
                        truthiness rules (the badge prop is `number | undefined`;
                        `0 && …` evaluates to `0` and renders as the digit). */}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2" role="group">
              <ThemeToggle className="hidden sm:inline-flex" />

              {/* Reclaim Phase 5 polish — primary CTA aligned with the
                  dashboard's "Snap a receipt" verb. Routes to the OCR wizard;
                  the wizard itself has a "log it manually" escape hatch for
                  receipt-less users (see NewBillUpload.tsx). */}
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate("/bills/new")}
                className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
                aria-label="Snap a receipt to log an expense"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline text-sm font-medium">
                  Snap a receipt
                </span>
              </Button>

              {/* Wellbie Button — hidden for soft launch (v1.1) via FF. */}
              {FF.WELLBIE_ENABLED && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    window.dispatchEvent(new Event("openWellbieChat"))
                  }
                  className="flex items-center gap-2"
                  aria-label="Open Wellbie AI assistant"
                >
                  <div className="h-6 w-6">
                    <WellbieAvatar
                      size="sm"
                      className="h-full w-full hover:scale-100"
                    />
                  </div>
                  <span className="hidden sm:inline text-sm font-medium">
                    Wellbie
                  </span>
                </Button>
              )}

              {/* Mobile Menu - only visible on mobile/tablet */}
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    aria-label="Open navigation menu"
                    aria-expanded={mobileMenuOpen}
                  >
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[300px] sm:w-[400px] bg-background z-[70]"
                >
                  <SheetHeader className="border-b pb-4 mb-4">
                    <SheetTitle>Menu</SheetTitle>
                  </SheetHeader>
                  <nav
                    className="flex flex-col gap-4"
                    aria-label="Mobile navigation menu"
                  >
                    {[
                      { heading: "Reclaim", items: coreItems },
                      { heading: "More", items: moreItems },
                    ].map(({ heading, items }) => (
                      <div key={heading} className="space-y-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
                          {heading}
                        </h3>
                        {items.map((item) => (
                          <Button
                            key={item.path}
                            variant="ghost"
                            className="justify-start w-full"
                            onClick={() => handleNavigation(item.path)}
                            aria-label={item.label}
                          >
                            <item.icon
                              className="h-5 w-5 mr-3"
                              aria-hidden="true"
                            />
                            <span className="flex-1 text-left">
                              {item.label}
                            </span>
                            {"badge" in item && (item.badge ?? 0) > 0 && (
                              <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                                {item.badge}
                              </span>
                            )}
                          </Button>
                        ))}
                      </div>
                    ))}

                    <div className="border-t pt-4 space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
                        Appearance
                      </h3>
                      <div className="px-2 pb-2">
                        <ThemeToggleGroup />
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
                        Account
                      </h3>
                      <Button
                        variant="ghost"
                        className="justify-start w-full"
                        onClick={() => handleNavigation("/settings")}
                        aria-label="Settings"
                      >
                        <Settings className="h-5 w-5 mr-3" aria-hidden="true" />
                        Settings
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start w-full"
                        onClick={() => {
                          handleSignOut();
                          setMobileMenuOpen(false);
                        }}
                        aria-label="Sign out of your account"
                      >
                        <LogOut className="h-5 w-5 mr-3" aria-hidden="true" />
                        Sign Out
                      </Button>
                    </div>
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </nav>

      {/* Wave 3 experiment: when SCOPE_GET_STARTED_TO_DASHBOARD is on, the
          Get-Started ribbon only appears on /dashboard. Avoids the "shame
          bar" effect of seeing 0/3 progress on every authenticated screen. */}
      {(!FF.SCOPE_GET_STARTED_TO_DASHBOARD ||
        location.pathname === "/dashboard") && <OnboardingProgressBar />}
    </>
  );
};
