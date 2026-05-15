import { useState, useEffect } from "react";
// Bill review feature archived
// import { BillReviewCard } from "@/components/bills/BillReviewCard";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { analytics } from "@/lib/analytics";
import { logError } from "@/utils/errorHandler";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { ActionCard } from "@/components/dashboard/ActionCard";
import { WellbieTip } from "@/components/dashboard/WellbieTip";
import { EmptyStateOnboarding } from "@/components/dashboard/EmptyStateOnboarding";
import { MissingHSADateBanner } from "@/components/dashboard/MissingHSADateBanner";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useHSA } from "@/contexts/HSAContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { QuickActionBar } from "@/components/dashboard/QuickActionBar";
import { TotalValueCard } from "@/components/dashboard/TotalValueCard";
import { HSAHealthCheck } from "@/components/dashboard/HSAHealthCheck";
import { AttentionBanner } from "@/components/dashboard/AttentionBanner";
import { useAttentionItems } from "@/hooks/useAttentionItems";
import { FF } from "@/lib/featureFlags";

const Dashboard = () => {
  const navigate = useNavigate();
  const { hasHSA, hsaOpenedDate, userIntent } = useHSA();
  const attention = useAttentionItems();

  // Show HSA features if user selected HSA intent or actually has an HSA
  const showHSAFeatures =
    userIntent === "hsa" || userIntent === "both" || hasHSA;
  const onboarding = useOnboarding();
  const [user, setUser] = useState<User | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectedSavings, setProjectedSavings] = useState<number | null>(null);
  const [stats, setStats] = useState({
    totalExpenses: 0,
    taxSavings: 0,
    rewardsEarned: 0,
    expenseCount: 0,
    unreviewedTransactions: 0,
    hsaClaimableAmount: 0,
    disputeSavings: 0,
  });
  interface RecentExpense {
    id: string;
    vendor: string;
    amount: number;
    is_hsa_eligible: boolean;
    invoice_date: string | null;
    date: string;
    reimbursement_strategy?: string;
  }
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([]);
  const [hasConnectedBank, setHasConnectedBank] = useState(false);
  // Bill review feature archived - removed pendingReviews and disputeStats

  useEffect(() => {
    // Auth is guaranteed by ProtectedRoute — just load the current user and data.
    // The loading gate must always release: previously `setLoading(false)` only
    // ran inside `if (session)`, so a stalled or session-less getSession kept the
    // skeleton on screen indefinitely. The 3s safety timeout caps this even if
    // getSession itself never resolves.
    const safetyTimeout = setTimeout(() => setLoading(false), 3000);
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session) setUser(session.user);
      })
      .finally(() => {
        clearTimeout(safetyTimeout);
        setLoading(false);
      });

    fetchStats();
    fetchTransactionStats();
    checkBankConnection();
    analytics.pageView("/dashboard");

    // Handle session expiration while on this page
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load calculator data if available (for new users)
  // Source of truth: sessionStorage on the very first visit; thereafter the
  // projection is persisted to profiles.calculator_projection so it survives
  // tab close until the user uploads their first bill (at which point the
  // empty state graduates to the populated dashboard).
  useEffect(() => {
    const loadCalculatorData = async () => {
      // Only load if user has 0 expenses and we have a user
      if (stats.expenseCount > 0 || !user) return;

      const sessionRaw = sessionStorage.getItem("calculatorData");

      if (sessionRaw) {
        // First visit — read from sessionStorage and persist to profile.
        try {
          const calculatorData = JSON.parse(sessionRaw);

          if (calculatorData.estimatedSavings) {
            setProjectedSavings(calculatorData.estimatedSavings);
          }

          const updates: Record<string, unknown> = {
            calculator_projection: calculatorData,
          };
          if (calculatorData.hasHSA) {
            updates.has_hsa = true;
          }
          const { error } = await supabase
            .from("profiles")
            .update(updates)
            .eq("id", user.id);
          if (error) logError("Error persisting calculator projection", error);

          sessionStorage.removeItem("calculatorData");
          sessionStorage.removeItem("estimatedSavings");
        } catch (error) {
          logError("Error loading calculator data", error);
        }
        return;
      }

      // Returning visit — fall back to profile.
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("calculator_projection")
          .eq("id", user.id)
          .maybeSingle();
        if (error) {
          logError("Error reading calculator_projection from profile", error);
          return;
        }
        const projection = profile?.calculator_projection as {
          estimatedSavings?: number;
        } | null;
        if (projection?.estimatedSavings) {
          setProjectedSavings(projection.estimatedSavings);
        }
      } catch (error) {
        logError("Error loading calculator_projection", error);
      }
    };

    loadCalculatorData();
  }, [stats.expenseCount, user]);

  const fetchStats = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: invoices, error } = await supabase
        .from("invoices")
        .select("id, amount, is_hsa_eligible, invoice_date, date")
        .order("date", { ascending: false });

      if (error) throw error;

      const totalInvoiced =
        invoices?.reduce((sum, inv) => sum + Number(inv.amount), 0) || 0;
      const hsaEligible =
        invoices
          ?.filter((inv) => inv.is_hsa_eligible)
          .reduce((sum, inv) => sum + Number(inv.amount), 0) || 0;

      // Calculate HSA claimable amount (HSA-eligible expenses that haven't been reimbursed)
      const { data: reimbursedInvoices } = await supabase
        .from("reimbursement_items")
        .select("invoice_id");

      const reimbursedIds = new Set(
        reimbursedInvoices?.map((r) => r.invoice_id) || [],
      );
      const hsaClaimable =
        invoices
          ?.filter((inv) => {
            if (!inv.is_hsa_eligible || reimbursedIds.has(inv.id)) return false;
            if (hsaOpenedDate) {
              const rawDate = inv.invoice_date || inv.date;
              if (!rawDate) return false;
              const invoiceDate = new Date(rawDate);
              const hsaDate = new Date(hsaOpenedDate);
              return !isNaN(invoiceDate.getTime()) && invoiceDate >= hsaDate;
            }
            return true;
          })
          .reduce((sum, inv) => sum + Number(inv.amount), 0) || 0;

      const taxSavings = hsaEligible * 0.3;
      const rewardsEarned = hsaEligible * 0.02; // Est. rewards on HSA-eligible spend only

      setStats((prev) => ({
        ...prev,
        totalExpenses: totalInvoiced,
        taxSavings,
        rewardsEarned,
        expenseCount: invoices?.length || 0,
        hsaClaimableAmount: hsaClaimable,
        disputeSavings: 0,
      }));

      setRecentExpenses(invoices?.slice(0, 5) || []);
    } catch (error) {
      logError("Failed to fetch stats", error);
    }
  };

  const checkBankConnection = async () => {
    try {
      const { data: accounts, error } = await supabase
        .from("plaid_connections")
        .select("id")
        .limit(1);

      if (error) throw error;
      setHasConnectedBank((accounts?.length || 0) > 0);
    } catch (error) {
      logError("Failed to check bank connection", error);
    }
  };

  const fetchTransactionStats = async () => {
    try {
      const { data: transactions, error } = await supabase
        .from("transactions")
        .select("needs_review")
        .eq("needs_review", true);

      if (error) throw error;
      setStats((prev) => ({
        ...prev,
        unreviewedTransactions: transactions?.length || 0,
      }));
    } catch (error) {
      logError("Failed to fetch transaction stats", error);
    }
  };

  // Bill review feature archived - removed fetchBillReviews and fetchDisputeStats

  const isNewUser =
    stats.expenseCount === 0 &&
    recentExpenses.length === 0 &&
    !hasConnectedBank;
  const firstName =
    user?.user_metadata?.full_name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "there";

  // Show welcome dialog for first-time users - MUST be before early returns.
  // Wave 3 experiment: when FF.AUTO_DISMISS_ONBOARDING_FOR_BILLING is on,
  // skip the auto-show for users who picked userIntent === 'billing' — the
  // HSA-mechanics carousel is dead weight for them. HSA / both still see it.
  useEffect(() => {
    const skipForBillingIntent =
      FF.AUTO_DISMISS_ONBOARDING_FOR_BILLING && userIntent === "billing";

    if (
      !loading &&
      !isNewUser &&
      stats.expenseCount <= 3 &&
      !onboarding.hasCompletedOnboarding &&
      !skipForBillingIntent
    ) {
      const timer = setTimeout(() => setShowWelcome(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [
    loading,
    isNewUser,
    stats.expenseCount,
    onboarding.hasCompletedOnboarding,
    userIntent,
  ]);

  if (loading) {
    return (
      <AuthenticatedLayout unreviewedTransactions={0}>
        <div role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading your dashboard…</span>
          <DashboardSkeleton />
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <ErrorBoundary
      fallbackTitle="Dashboard Error"
      fallbackDescription="We encountered an error loading your dashboard. Your data is safe. Please try again."
      onReset={() => window.location.reload()}
    >
      <AuthenticatedLayout
        unreviewedTransactions={stats.unreviewedTransactions}
      >
        <div
          id="main-content"
          className="container mx-auto max-w-7xl px-4 py-4 md:py-6 pb-8 md:pb-12 space-y-6"
        >
          {!hsaOpenedDate && stats.expenseCount > 0 && (
            <MissingHSADateBanner onDateSet={fetchStats} />
          )}

          {!isNewUser && <AttentionBanner attention={attention} />}

          {isNewUser ? (
            <EmptyStateOnboarding projectedSavings={projectedSavings} />
          ) : (
            <>
              <OnboardingWizard
                open={showWelcome}
                onOpenChange={(open) => {
                  if (!open) setShowWelcome(false);
                }}
              />

              {/* Simplified Single-Page Dashboard */}
              <div className="space-y-4">
                {/* Welcome Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold">
                      Welcome back, {firstName}! 👋
                    </h1>
                    <p className="text-muted-foreground mt-1">
                      Here's what needs your attention
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate("/reports")}
                    variant="outline"
                    className="gap-2"
                  >
                    <BarChart3 className="h-4 w-4" />
                    View Reports
                  </Button>
                </div>

                {/* Hero Metrics */}
                <TotalValueCard
                  taxSavings={stats.taxSavings}
                  disputeSavings={stats.disputeSavings}
                  rewardsEarned={stats.rewardsEarned}
                  paymentOptimizations={0}
                  hasHSA={hasHSA}
                  hsaClaimableAmount={stats.hsaClaimableAmount}
                  totalTracked={stats.totalExpenses}
                  billCount={stats.expenseCount}
                />

                {/* Quick Actions */}
                <QuickActionBar
                  hasHSA={hasHSA}
                  hsaClaimable={stats.hsaClaimableAmount}
                  unreviewedTransactions={stats.unreviewedTransactions}
                />

                {/* HSA Health Check - Adaptive Widget */}
                {showHSAFeatures && (
                  <HSAHealthCheck
                    hasHSA={hasHSA}
                    unreimbursedExpenses={stats.hsaClaimableAmount}
                  />
                )}

                {/* Recent Bills */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    {recentExpenses.length > 0 && (
                      <ActionCard
                        icon="🏥"
                        title="Recent Medical Bills"
                        count={recentExpenses.length}
                        actions={
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate("/bills")}
                          >
                            View All
                          </Button>
                        }
                        buttonText="Show recent bills"
                      >
                        <div className="space-y-3">
                          {recentExpenses.slice(0, 3).map((expense) => (
                            <div
                              key={expense.id}
                              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                              onClick={() => navigate(`/bills/${expense.id}`)}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">
                                    {expense.vendor}
                                  </p>
                                  {(() => {
                                    const rawDate =
                                      expense.invoice_date || expense.date;
                                    const eligibleAfter =
                                      expense.is_hsa_eligible &&
                                      (!hsaOpenedDate ||
                                        (rawDate &&
                                          new Date(rawDate) >=
                                            new Date(hsaOpenedDate)));
                                    return eligibleAfter ? (
                                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                        HSA-eligible ✓
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(expense.date).toLocaleDateString()}
                                </p>
                              </div>
                              <p className="font-semibold">
                                ${Number(expense.amount).toFixed(2)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </ActionCard>
                    )}

                    {/* Bill review feature archived - removed pending reviews section */}
                  </div>

                  {/* Side Cards */}
                  <div className="space-y-4">
                    <WellbieTip
                      unreviewedCount={stats.unreviewedTransactions}
                      hasExpenses={stats.expenseCount > 0}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
};

export default Dashboard;
