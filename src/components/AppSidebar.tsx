import {
  Receipt,
  FileText,
  Settings,
  HelpCircle,
  ClipboardCheck,
  LayoutDashboard,
  Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useHSA } from "@/contexts/HSAContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";

interface AppSidebarProps {
  unreviewedTransactions?: number;
}

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
  badgeKey: string | null;
  hsaOnly?: boolean;
}

// Primary IA: the app's Categorize -> Substantiate -> Reimburse spine, with
// Dashboard as the front door. "Reimburse" is the third step (building a
// reimbursement packet from already-substantiated expenses), which is why it
// is not called "Substantiation" -- see design review Phase 5, 2026-09-04.
//
// Nothing is collapsed any more (2026-09-05). Every group renders open: the
// "More" group had held Bank Accounts, Documents and HSA Guide behind a closed
// disclosure, and because its open/closed state was component state and this
// sidebar remounts on every route change, expanding it never survived a single
// navigation. Three destinations were effectively unreachable by browsing.
const primaryMenuItems: MenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/dashboard",
    badgeKey: null,
  },
  // Step one, and it is named for what it lists: transactions the bank sent,
  // waiting to be sorted into medical or not. Carries the unreviewed count,
  // because this is where that sorting happens.
  {
    icon: Receipt,
    label: "Transactions",
    path: "/transactions",
    badgeKey: "unreviewedTransactions",
  },
  // Step two, and the expense list proper: an expense is the claim built from
  // a transaction, and it is the object that carries the date of service, the
  // patient and the documentation. "Substantiate" survives as the verb on the
  // page itself -- precise, but too rare a word to spend a nav slot on.
  {
    icon: ClipboardCheck,
    label: "Expenses",
    path: "/substantiate",
    badgeKey: null,
  },
  {
    icon: FileText,
    label: "Reimburse",
    path: "/substantiation",
    badgeKey: null,
  },
];

const moreMenuItems: MenuItem[] = [
  {
    icon: Building2,
    label: "Bank Accounts",
    path: "/bank-accounts",
    badgeKey: null,
  },
  { icon: FileText, label: "Documents", path: "/documents", badgeKey: null },
  { icon: HelpCircle, label: "HSA Guide", path: "/guide", badgeKey: null },
];

export function AppSidebar({ unreviewedTransactions = 0 }: AppSidebarProps) {
  const { open } = useSidebar();
  const { hasHSA, userIntent } = useHSA();
  const { tier, createCheckoutSession } = useSubscription();

  // Show HSA features if user selected HSA intent or actually has an HSA
  const showHSAFeatures =
    userIntent === "hsa" || userIntent === "both" || hasHSA;

  const getBadgeCount = (badgeKey: string | null) => {
    if (!badgeKey) return 0;
    if (badgeKey === "unreviewedTransactions") return unreviewedTransactions;
    return 0;
  };

  const renderMenuSection = (items: MenuItem[], label: string) => {
    // Filter HSA-only items if user doesn't have HSA features enabled
    const filteredItems = items.filter(
      (item) => !item.hsaOnly || showHSAFeatures,
    );

    if (filteredItems.length === 0) return null;

    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {filteredItems.map((item) => {
              const badgeCount = getBadgeCount(item.badgeKey);
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/dashboard"}
                      className="relative"
                    >
                      <item.icon className="h-4 w-4" />
                      {open && <span>{item.label}</span>}
                      {badgeCount > 0 && open && (
                        <span className="ml-auto bg-accent text-accent-foreground text-xs px-2 py-0.5 rounded-full">
                          {badgeCount}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="overflow-y-auto">
        {renderMenuSection(primaryMenuItems, "Reclaim")}
        {renderMenuSection(moreMenuItems, "More")}

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* "Manage Reviews" (admin) and "Share Feedback" removed
                  2026-08-19 with the provider-reviews pages. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Settings">
                  <NavLink to="/settings">
                    <Settings className="h-4 w-4" />
                    {open && <span>Settings</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {tier === "free" && open && (
        <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
          {/* Was navigate("/checkout") -- a page removed on 2026-08-19 that
              only the deleted tripwire offer could reach, so this button had
              been landing on the 404 page. Subscription checkout goes through
              the context to a Stripe-hosted page instead. */}
          <button
            onClick={() => void createCheckoutSession("plus")}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <span>Free Plan</span>
            <span className="text-primary font-medium">Upgrade</span>
          </button>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
