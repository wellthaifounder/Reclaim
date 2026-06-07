import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { WellthLogo } from "@/components/WellthLogo";
import {
  LogOut,
  Calculator,
  Receipt,
  FileText,
  Menu,
  Settings,
  Wallet,
  TrendingUp,
  FolderHeart,
  ClipboardList,
  LayoutDashboard,
  Building2,
  HelpCircle,
} from "lucide-react";
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

  // Reclaim Phase 5 W1 — primary nav matches AppSidebar + BottomTabNavigation:
  //   Dashboard · Expenses · Expense Groups · Substantiation
  const mainNavItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    {
      icon: Receipt,
      label: "Expenses",
      path: "/expenses",
      badge: pendingReviews,
    },
    { icon: FolderHeart, label: "Expense Groups", path: "/expense-groups" },
    { icon: FileText, label: "Substantiation", path: "/substantiation" },
  ];

  // Mobile hamburger sections — mirror sidebar groups.
  const coreItems = mainNavItems;

  const moreItems = [
    {
      icon: Wallet,
      label: "Transactions",
      path: "/transactions",
      badge: unreviewedTransactions,
    },
    { icon: Building2, label: "Bank Accounts", path: "/bank-accounts" },
    {
      icon: ClipboardList,
      label: "HSA Claims",
      path: "/reimbursement-requests",
    },
    { icon: Calculator, label: "HSA Calculator", path: "/savings-calculator" },
    { icon: TrendingUp, label: "Reports", path: "/reports" },
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
                <WellthLogo size="sm" showTagline className="hidden sm:block" />
                <WellthLogo variant="icon" size="sm" className="sm:hidden" />
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
                      "relative flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                      isActivePath(item.path)
                        ? "text-primary bg-accent"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                    aria-label={item.label}
                    aria-current={isActivePath(item.path) ? "page" : undefined}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2" role="group">
              {/* Upload Bill Button - Primary CTA */}
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate("/bills/new")}
                className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
                aria-label="Upload a new medical bill"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline text-sm font-medium">
                  Upload Bill
                </span>
              </Button>

              {/* Wellbie Button */}
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
                            {"badge" in item && item.badge > 0 && (
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
