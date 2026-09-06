import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthenticatedNav } from "@/components/AuthenticatedNav";
import { BottomTabNavigation } from "@/components/BottomTabNavigation";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useAttentionItems } from "@/hooks/useAttentionItems";

interface AuthenticatedLayoutProps {
  children: ReactNode;
  /**
   * Suppress the mobile bottom-tab navigation. Use for focused tasks (e.g. the
   * bill-upload wizard) where the bottom nav would clip primary CTAs at the
   * bottom of the viewport.
   */
  hideBottomNav?: boolean;
}

export const AuthenticatedLayout = ({
  children,
  hideBottomNav = false,
}: AuthenticatedLayoutProps) => {
  // Enable session timeout for security (15 min inactivity, 2 min warning)
  useSessionTimeout(15, 2);

  // The nav badge used to be handed down as a prop, which meant every page
  // except /expenses rendered <AuthenticatedLayout> with no props and got a
  // permanently-0 badge, and even /expenses went stale the moment a decision
  // was made through the review feed (its bulk-decide RPC invalidates
  // react-query keys this page's own locally-fetched `transactions` state
  // never subscribed to). Reading the count here, from the same query every
  // mutation invalidates, means the badge is live everywhere the layout is
  // used and never depends on any one page's own fetch cycle.
  const { unreviewedTransactions, readyToClaim } = useAttentionItems();

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full overflow-x-hidden">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden lg:block">
          <AppSidebar unreviewedTransactions={unreviewedTransactions} />
        </div>

        <div className="flex-1 flex flex-col w-full">
          {/* Top Navigation Bar */}
          <AuthenticatedNav
            unreviewedTransactions={unreviewedTransactions}
            pendingReviews={readyToClaim}
          />

          {/* Desktop Sidebar Trigger - visible on desktop */}
          <div className="hidden lg:block border-b border-border/40 px-4 py-2">
            <SidebarTrigger className="-ml-1" />
          </div>

          {/* Main Content */}
          <main className={hideBottomNav ? "flex-1" : "flex-1 pb-20 lg:pb-0"}>
            {children}
          </main>

          {/* Bottom Tab Navigation - mobile only, hidden for focused-task pages */}
          {/* BottomTabNavigation reads what it needs from context and takes
              no props. */}
          {!hideBottomNav && <BottomTabNavigation />}
        </div>
      </div>
    </SidebarProvider>
  );
};
