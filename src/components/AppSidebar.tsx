import { useState } from "react";
import {
  Receipt,
  FileText,
  Wallet,
  Settings,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LayoutDashboard,
  Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

// Reclaim Phase 5 W1 — primary IA per brief §9.
//   Dashboard · Expenses · Expense Groups · Substantiation
// Everything Wellth-era (Transactions, HSA Claims, HSA Calculator, Reports,
// Documents, Bank Accounts, HSA Guide, Ledger) lives behind the "More" group
// below until Phase 6 dead-code sweep decides what stays.
const primaryMenuItems: MenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/dashboard",
    badgeKey: null,
  },
  { icon: Receipt, label: "Expenses", path: "/expenses", badgeKey: null },
  {
    icon: FileText,
    label: "Substantiation",
    path: "/substantiation",
    badgeKey: null,
  },
];

const moreMenuItems: MenuItem[] = [
  {
    icon: Wallet,
    label: "Transactions",
    path: "/transactions",
    badgeKey: "unreviewedTransactions",
  },
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
  const navigate = useNavigate();
  const { hasHSA, userIntent } = useHSA();
  const { tier } = useSubscription();

  // Show HSA features if user selected HSA intent or actually has an HSA
  const showHSAFeatures =
    userIntent === "hsa" || userIntent === "both" || hasHSA;

  // Reclaim Phase 5 W1: primary nav (4 tabs) open by default; "More" group
  // collapsed by default so the Wellth-era tools don't compete visually with
  // the Reclaim flow.
  const [openSections, setOpenSections] = useState({
    primary: true,
    more: false,
    account: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const getBadgeCount = (badgeKey: string | null) => {
    if (!badgeKey) return 0;
    if (badgeKey === "unreviewedTransactions") return unreviewedTransactions;
    return 0;
  };

  const renderMenuSection = (
    items: MenuItem[],
    label: string,
    sectionKey: keyof typeof openSections,
  ) => {
    // Filter HSA-only items if user doesn't have HSA features enabled
    const filteredItems = items.filter(
      (item) => !item.hsaOnly || showHSAFeatures,
    );

    if (filteredItems.length === 0) return null;

    const isOpen = openSections[sectionKey];

    return (
      <Collapsible open={isOpen} onOpenChange={() => toggleSection(sectionKey)}>
        <SidebarGroup>
          <CollapsibleTrigger className="w-full">
            <SidebarGroupLabel className="flex items-center justify-between w-full cursor-pointer hover:bg-sidebar-accent/50 rounded-md px-2 py-1.5 transition-colors">
              <span>{label}</span>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          <CollapsibleContent>
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
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="overflow-y-auto">
        {renderMenuSection(primaryMenuItems, "Reclaim", "primary")}
        {renderMenuSection(moreMenuItems, "More", "more")}

        <Collapsible
          open={openSections.account}
          onOpenChange={() => toggleSection("account")}
          className="mt-auto"
        >
          <SidebarGroup>
            <CollapsibleTrigger className="w-full">
              <SidebarGroupLabel className="flex items-center justify-between w-full cursor-pointer hover:bg-sidebar-accent/50 rounded-md px-2 py-1.5 transition-colors">
                <span>Account</span>
                {openSections.account ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>

      {tier === "free" && open && (
        <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
          <button
            onClick={() => navigate("/checkout")}
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
