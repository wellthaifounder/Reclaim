// Reclaim — 4-tab mobile bottom navigation.
//
// Follows the spec's spine in order: Transactions is where money gets sorted
// into medical / non-medical, Expenses is what came out of that, and Reimburse
// is where a reimbursement packet gets built. Expense Groups was retired on
// 2026-08-20 with the rest of the care-events surface, and Transactions took
// the free slot — it is step one of the workflow and had been buried behind
// "More".
//
// Labelled "Reimburse," not "Records" or "Substantiation" -- this tab is the
// third step of Categorize -> Substantiate -> Reimburse, not the second. See
// design review Phase 5 correction, 2026-09-04.
//
// The remaining surfaces (Documents, Bank Accounts) live behind the sidebar's
// "More" group on desktop and the hamburger sheet on mobile.

import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  Receipt,
  ClipboardCheck,
  FileText,
} from "lucide-react";

// The four tabs are the workflow in order. Documents gave up its slot to
// Substantiate: it is a library, reachable from the sidebar's "More" group and
// from every expense, whereas Substantiate is a step with a queue behind it.
const TABS = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Receipt, label: "Expenses", path: "/expenses" },
  { icon: ClipboardCheck, label: "Substantiate", path: "/substantiate" },
  { icon: FileText, label: "Reimburse", path: "/substantiation" },
];

export const BottomTabNavigation = () => {
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
      </div>
    </nav>
  );
};
