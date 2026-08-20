// Reclaim — 4-tab mobile bottom navigation.
//
// Follows the spec's spine in order: Transactions is where money gets sorted
// into medical / non-medical, Expenses is what came out of that, and Records
// is where a claim gets built. Expense Groups was retired on 2026-08-20 with
// the rest of the care-events surface, and Transactions took the free slot —
// it is step one of the workflow and had been buried behind "More".
//
// Wellbie chat stays as its own action button — invoked via window event
// so the layout component owns the chat instance (no double-mounting).
// The remaining surfaces (Documents, Bank Accounts) live behind the sidebar's
// "More" group on desktop and the hamburger sheet on mobile.

import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  Receipt,
  Wallet,
  FileText,
  MessageCircle,
} from "lucide-react";
import { FF } from "@/lib/featureFlags";

const TABS = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Wallet, label: "Transactions", path: "/transactions" },
  { icon: Receipt, label: "Expenses", path: "/expenses" },
  { icon: FileText, label: "Records", path: "/substantiation" },
];

export const BottomTabNavigation = () => {
  const handleOpenWellbie = () => {
    window.dispatchEvent(new Event("openWellbieChat"));
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/40 safe-area-inset-bottom"
      aria-label="Bottom navigation"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === "/dashboard"}
            className="flex flex-col items-center justify-center flex-1 h-full gap-1 rounded-lg transition-colors hover:bg-accent/50"
            activeClassName="text-primary"
          >
            <tab.icon className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">{tab.label}</span>
          </NavLink>
        ))}
        {/* Wellbie tab — hidden for soft launch (v1.1) via FF. */}
        {FF.WELLBIE_ENABLED && (
          <button
            onClick={handleOpenWellbie}
            className="flex flex-col items-center justify-center flex-1 h-full gap-1 rounded-lg transition-colors hover:bg-accent/50 text-muted-foreground"
            aria-label="Ask Wellbie AI assistant"
          >
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">Wellbie</span>
          </button>
        )}
      </div>
    </nav>
  );
};
