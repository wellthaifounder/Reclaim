import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthenticatedNav } from "@/components/AuthenticatedNav";
import { BottomTabNavigation } from "@/components/BottomTabNavigation";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";

interface AuthenticatedLayoutProps {
  children: ReactNode;
  unreviewedTransactions?: number;
  pendingReviews?: number;
  /**
   * Suppress the mobile bottom-tab navigation. Use for focused tasks (e.g. the
   * bill-upload wizard) where the bottom nav would clip primary CTAs at the
   * bottom of the viewport.
   */
  hideBottomNav?: boolean;
}

export const AuthenticatedLayout = ({
  children,
  unreviewedTransactions = 0,
  pendingReviews = 0,
  hideBottomNav = false,
}: AuthenticatedLayoutProps) => {
  // Enable session timeout for security (15 min inactivity, 2 min warning)
  useSessionTimeout(15, 2);

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full overflow-x-hidden">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden lg:block">
          {/* AppSidebar takes no pendingReviews prop; only AuthenticatedNav
              renders that badge. */}
          <AppSidebar unreviewedTransactions={unreviewedTransactions} />
        </div>

        <div className="flex-1 flex flex-col w-full">
          {/* Top Navigation Bar */}
          <AuthenticatedNav
            unreviewedTransactions={unreviewedTransactions}
            pendingReviews={pendingReviews}
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
