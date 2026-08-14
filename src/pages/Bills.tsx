import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import {
  calculateHSAEligibility,
  getPaymentStatusBadge,
  type PaymentTransaction,
} from "@/lib/hsaCalculations";
import { Link } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { logError } from "@/utils/errorHandler";
import { withQueryTimeout } from "@/lib/queryHelpers";
import { FF } from "@/lib/featureFlags";
import { analytics } from "@/lib/analytics";
import Ledger from "@/pages/Ledger";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillsHeroMetrics } from "@/components/bills/BillsHeroMetrics";
import { useOnboarding } from "@/contexts/OnboardingContext";
// Bill review feature archived
// import { BillReviewCard } from "@/components/bills/BillReviewCard";
// import { DisputeAnalyticsDashboard } from "@/components/bills/DisputeAnalyticsDashboard";

interface BillPaymentTransaction extends PaymentTransaction {
  auto_linked?: boolean;
}

interface Bill {
  id: string;
  vendor: string;
  category: string;
  date: string;
  amount: number;
  total_amount?: number;
  is_hsa_eligible: boolean;
  payment_transactions: BillPaymentTransaction[];
}

type BillsView = "list" | "ledger";

const isBillsView = (v: string | null): v is BillsView =>
  v === "list" || v === "ledger";

const Bills = () => {
  const navigate = useNavigate();
  const { hasSeenLedgerWorkflow } = useOnboarding();
  const [searchParams, setSearchParams] = useSearchParams();

  // Wave 4 IA-collapse experiment: when FF.BILLS_LEDGER_IA_COLLAPSE is on, the
  // /ledger route redirects here as /bills?view=ledger and we render <Ledger
  // embedded /> inline. With the flag off, currentView is forced to "list" and
  // the ?view param is ignored — /ledger keeps its own standalone route.
  const requestedView = searchParams.get("view");
  const currentView: BillsView =
    FF.BILLS_LEDGER_IA_COLLAPSE && isBillsView(requestedView)
      ? requestedView
      : "list";

  // Track whichever view actually rendered (post-flag, post-fallback). Re-fire
  // whenever the user toggles the tab so we get per-view dwell signal.
  useEffect(() => {
    if (!FF.BILLS_LEDGER_IA_COLLAPSE) return;
    analytics.track({
      type: "bills_view_selected",
      action: currentView,
      metadata: { view: currentView },
    });
  }, [currentView]);

  const handleViewChange = (next: string) => {
    if (!isBillsView(next) || next === currentView) return;
    const sp = new URLSearchParams(searchParams);
    if (next === "list") sp.delete("view");
    else sp.set("view", next);
    setSearchParams(sp, { replace: true });
  };

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [hideFullyReimbursed, setHideFullyReimbursed] = useState(true);
  const [hideFullyPaid, setHideFullyPaid] = useState(true);
  const [showOnlyHSAEligible, setShowOnlyHSAEligible] = useState(false);

  // Fetch bills data
  const {
    data: bills,
    isLoading: billsLoading,
    isError: billsError,
    refetch: refetchBills,
  } = useQuery({
    queryKey: ["bills"],
    queryFn: () =>
      withQueryTimeout(async (signal) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error("Not authenticated");

        const { data, error } = await supabase
          .from("invoices")
          .select(
            `
            *,
            payment_transactions (
              id,
              payment_date,
              amount,
              payment_source,
              is_reimbursed,
              reimbursed_date,
              auto_linked
            )
          `,
          )
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(500) // Limit to most recent 500 bills for performance
          .abortSignal(signal);

        if (error) throw error;
        return data as Bill[];
      }),
    meta: {
      errorMessage: "We had trouble loading your expenses. Please try again.",
    },
  });

  // Bill review feature archived - removed review and dispute queries

  const toggleHSAEligibility = async (
    billId: string,
    currentStatus: boolean,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    try {
      const { error } = await supabase
        .from("invoices")
        // Workstream B: is_hsa_eligible is derived from eligibility_state.
        // A manual toggle here IS an explicit user determination, so it earns
        // 'eligible'; clearing it returns the expense to 'unknown' rather than
        // asserting ineligibility, which is a different claim.
        .update({ eligibility_state: !currentStatus ? "eligible" : "unknown" })
        .eq("id", billId);

      if (error) throw error;
      refetchBills();
      toast.success(
        `HSA eligibility ${!currentStatus ? "enabled" : "disabled"}`,
      );
    } catch (error) {
      logError("Error toggling HSA eligibility", error);
      toast.error("Failed to update HSA eligibility");
    }
  };

  const filteredBills = useMemo(() => {
    if (!bills) return [];
    return bills.filter((bill) => {
      if (
        searchTerm &&
        !bill.vendor.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      const breakdown = calculateHSAEligibility(
        bill,
        bill.payment_transactions || [],
      );

      if (
        hideFullyReimbursed &&
        breakdown.paidViaHSA === breakdown.totalInvoiced &&
        breakdown.totalInvoiced > 0
      ) {
        return false;
      }

      if (
        hideFullyPaid &&
        breakdown.unpaidBalance === 0 &&
        breakdown.totalInvoiced > 0
      ) {
        return false;
      }

      if (showOnlyHSAEligible && !bill.is_hsa_eligible) {
        return false;
      }

      return true;
    });
  }, [
    bills,
    searchTerm,
    hideFullyReimbursed,
    hideFullyPaid,
    showOnlyHSAEligible,
  ]);

  // Bill review feature archived - removed review/dispute aggregations

  const aggregateStats = useMemo(() => {
    let totalInvoiced = 0;
    let totalPaidHSA = 0;
    let totalPaidOther = 0;
    let totalUnpaid = 0;
    let totalHSAEligible = 0;

    filteredBills.forEach((bill) => {
      const breakdown = calculateHSAEligibility(
        bill,
        bill.payment_transactions || [],
      );
      totalInvoiced += breakdown.totalInvoiced;
      totalPaidHSA += breakdown.paidViaHSA;
      totalPaidOther += breakdown.paidViaOther;
      totalUnpaid += breakdown.unpaidBalance;
      totalHSAEligible += breakdown.hsaReimbursementEligible;
    });

    return {
      totalInvoiced,
      totalPaidHSA,
      totalPaidOther,
      totalUnpaid,
      totalHSAEligible,
    };
  }, [filteredBills]);

  // The view switcher is only rendered when the IA-collapse flag is on. With
  // the flag off, Bills only ever shows the list, so showing tabs would be
  // misleading.
  const viewSwitcher = FF.BILLS_LEDGER_IA_COLLAPSE ? (
    <Tabs value={currentView} onValueChange={handleViewChange} className="mb-2">
      <TabsList>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="ledger">Ledger</TabsTrigger>
      </TabsList>
    </Tabs>
  ) : null;

  // Short-circuit: when the user lands on /bills?view=ledger, render the
  // Ledger page inline (no double AuthenticatedLayout via `embedded`). The
  // existing Bills query has already been kicked off but the result is
  // cached by React Query for when they switch back to the list.
  if (currentView === "ledger") {
    return (
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 pt-6 max-w-7xl">
          {viewSwitcher}
        </div>
        <Ledger embedded />
      </AuthenticatedLayout>
    );
  }

  if (billsLoading) {
    return (
      <AuthenticatedLayout>
        <div
          className="flex items-center justify-center min-h-[400px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading your bills…</span>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthenticatedLayout>
    );
  }

  // If the query errored (timeout or network), the global QueryCache.onError
  // already surfaced a toast. Render the page in its degraded empty state with
  // a Retry button so the user has a clear next step.
  if (billsError) {
    return (
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <Card>
            <CardContent className="text-center py-12 space-y-3">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                We had trouble loading your bills.
              </p>
              <Button variant="outline" onClick={() => refetchBills()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        {viewSwitcher}
        {/* Header */}
        <div className="flex items-center justify-between sticky top-0 z-10 bg-background py-2 -mt-2">
          <div>
            <h1 className="text-3xl font-bold mb-1">Expenses</h1>
            <p className="text-muted-foreground text-sm">
              Track and manage your medical expenses
            </p>
          </div>
          <Button onClick={() => navigate("/bills/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Add expense
          </Button>
        </div>

        {/* Ledger nudge for new users */}
        {!hasSeenLedgerWorkflow && (
          <p className="text-sm text-muted-foreground">
            After uploading, head to the{" "}
            <Link
              to={
                FF.BILLS_LEDGER_IA_COLLAPSE ? "/bills?view=ledger" : "/ledger"
              }
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              Ledger
            </Link>{" "}
            to classify and organize your bills.
          </p>
        )}

        {/* Hero Metrics */}
        <BillsHeroMetrics
          totalBilled={aggregateStats.totalInvoiced}
          paidViaHSA={aggregateStats.totalPaidHSA}
          paidOther={aggregateStats.totalPaidOther}
          unpaidBalance={aggregateStats.totalUnpaid}
        />

        {/* Bills List */}
        <div className="space-y-4">
          {""}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Customize which bills to display
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by vendor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hideReimbursed"
                    checked={hideFullyReimbursed}
                    onCheckedChange={(checked) =>
                      setHideFullyReimbursed(checked as boolean)
                    }
                  />
                  <Label htmlFor="hideReimbursed" className="cursor-pointer">
                    Hide Fully Reimbursed
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hidePaid"
                    checked={hideFullyPaid}
                    onCheckedChange={(checked) =>
                      setHideFullyPaid(checked as boolean)
                    }
                  />
                  <Label htmlFor="hidePaid" className="cursor-pointer">
                    Hide Fully Paid
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hsaOnly"
                    checked={showOnlyHSAEligible}
                    onCheckedChange={(checked) =>
                      setShowOnlyHSAEligible(checked as boolean)
                    }
                  />
                  <Label htmlFor="hsaOnly" className="cursor-pointer">
                    HSA Eligible Only
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>All Expenses</CardTitle>
                <Button onClick={() => navigate("/bills/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add expense
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {filteredBills.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-1">
                    No bills match your current filters
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {showOnlyHSAEligible
                      ? "Try turning off the HSA-eligible filter to see all bills."
                      : searchTerm
                        ? `No results for "${searchTerm}". Try a different search term.`
                        : "Try adjusting your filter settings."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setShowOnlyHSAEligible(false);
                      setHideFullyReimbursed(false);
                      setHideFullyPaid(false);
                    }}
                  >
                    Clear all filters
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredBills.map((bill) => (
                    <div
                      key={bill.id}
                      className="p-4 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/bills/${bill.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{bill.vendor}</h4>
                          <p className="text-sm text-muted-foreground">
                            {bill.category} •{" "}
                            {new Date(bill.date).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            ${Number(bill.amount).toFixed(2)}
                          </p>
                          <div className="flex items-center gap-1 justify-end mt-1">
                            {(() => {
                              const breakdown = calculateHSAEligibility(
                                bill,
                                bill.payment_transactions || [],
                              );
                              const badge = getPaymentStatusBadge(
                                breakdown.totalInvoiced,
                                breakdown.paidViaHSA,
                                breakdown.paidViaOther,
                              );
                              return (
                                <Badge
                                  variant="outline"
                                  className={badge.color}
                                >
                                  {badge.status}
                                </Badge>
                              );
                            })()}
                            {bill.payment_transactions?.some(
                              (pt) => pt.auto_linked,
                            ) && (
                              <Badge
                                variant="outline"
                                className="bg-blue-500/10 text-blue-600 border-blue-500/20"
                              >
                                Auto-matched
                              </Badge>
                            )}
                            {bill.is_hsa_eligible && (
                              <Badge variant="secondary">HSA Eligible</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthenticatedLayout>
  );
};

export default Bills;
