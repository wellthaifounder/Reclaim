import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
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
import { Plus, Loader2, FileText, Search, ClipboardCheck } from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { withQueryTimeout } from "@/lib/queryHelpers";
import { BillsHeroMetrics } from "@/components/bills/BillsHeroMetrics";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { formatDateOnly } from "@/lib/dates";
// Bill review feature archived
// import { BillReviewCard } from "@/components/bills/BillReviewCard";
// import { DisputeAnalyticsDashboard } from "@/components/bills/DisputeAnalyticsDashboard";

interface Bill {
  id: string;
  vendor: string;
  category: string;
  date: string;
  amount: number;
  total_amount?: number;
  // Was is_hsa_eligible, a derived column being retired. The query selects *,
  // so this arrives without a query change; 'eligible' is exactly what the old
  // boolean meant.
  eligibility_state:
    Database["public"]["Enums"]["expense_eligibility_state"] | null;
  // The money model from the workflow spec. The query selects *, so these
  // arrive without a query change; they are what the summary above the list
  // and the claim screen both count.
  amount_paid?: number | null;
  reimbursable_amount?: number | null;
  reimbursed_amount?: number | null;
  claim_state: Database["public"]["Enums"]["expense_claim_state"] | null;
}

interface BillsProps {
  /**
   * Render as a panel inside another page rather than as a page of its own.
   *
   * The expense list is now a tab on /expenses, which already supplies the
   * layout chrome and its own heading. Embedding skips both, so there is one
   * sidebar and one <h1> on the page rather than two of each.
   */
  embedded?: boolean;
}

const Bills = ({ embedded = false }: BillsProps) => {
  // Every return path in this component goes through Shell, so embedding is
  // decided once here rather than at each of the loading / error / loaded
  // branches.
  const Shell = ({ children }: { children: React.ReactNode }) =>
    embedded ? (
      <>{children}</>
    ) : (
      <AuthenticatedLayout>{children}</AuthenticatedLayout>
    );

  const navigate = useNavigate();

  // Which expense the substantiate dialog is open for, or null for closed.
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  // Defaults to off. The two filters this replaces both defaulted to ON, so
  // the list opened with expenses already hidden and no indication that it
  // had done so -- a user who could not find something they had just added
  // had no way to know a checkbox was the reason.
  const [hideClaimed, setHideClaimed] = useState(false);
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
          .select("*")
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

  const filteredBills = useMemo(() => {
    if (!bills) return [];
    return bills.filter((bill) => {
      if (
        searchTerm &&
        !bill.vendor.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      // "Hide fully reimbursed" and "Hide fully paid" went with the payments
      // table (2026-08-21). Both asked how much of a bill had been settled,
      // which is not a question about an expense the bank already shows as
      // paid. "Hide what I've already claimed" is the useful version and it
      // reads claim_state, which is the column that actually knows.
      if (hideClaimed && (bill.claim_state ?? "unclaimed") !== "unclaimed") {
        return false;
      }

      if (showOnlyHSAEligible && bill.eligibility_state !== "eligible") {
        return false;
      }

      return true;
    });
  }, [bills, searchTerm, hideClaimed, showOnlyHSAEligible]);

  // Bill review feature archived - removed review/dispute aggregations

  // The summary counts what is on screen, so it responds to the filters
  // above it rather than quietly reporting a different population.

  if (billsLoading) {
    return (
      <Shell>
        <div
          className="flex items-center justify-center min-h-[400px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading your expenses…</span>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  // If the query errored (timeout or network), the global QueryCache.onError
  // already surfaced a toast. Render the page in its degraded empty state with
  // a Retry button so the user has a clear next step.
  if (billsError) {
    return (
      <Shell>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <Card>
            <CardContent className="text-center py-12 space-y-3">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                We had trouble loading your expenses.
              </p>
              <Button variant="outline" onClick={() => refetchBills()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div
        className={
          embedded
            ? "space-y-6"
            : "container mx-auto px-4 py-8 max-w-6xl space-y-6"
        }
      >
        {/* Header. Suppressed when embedded -- the host page already carries
            the "Expenses" heading and the add button. */}
        {!embedded && (
          <div className="flex items-center justify-between sticky top-0 z-10 bg-background py-2 -mt-2">
            <div>
              <h1 className="text-3xl font-bold mb-1">Expenses</h1>
              <p className="text-muted-foreground text-sm">
                Everything you have spent on care, and how close each is to money back
              </p>
            </div>
            <Button onClick={() => navigate("/expenses/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add expense
            </Button>
          </div>
        )}

        {/* Hero Metrics */}
        <BillsHeroMetrics rows={filteredBills} />

        {/* Bills List */}
        <div className="space-y-4">
          {""}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Customize which expenses to display
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
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hideClaimed"
                    checked={hideClaimed}
                    onCheckedChange={(checked) =>
                      setHideClaimed(checked as boolean)
                    }
                  />
                  <Label htmlFor="hideClaimed" className="cursor-pointer">
                    Hide what I've already claimed
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
                    Only show what's eligible
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>All Expenses</CardTitle>
                <Button onClick={() => navigate("/expenses/new")}>
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
                    No expenses match your current filters
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {showOnlyHSAEligible
                      ? "Turn off the eligibility filter to see everything."
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
                      setHideClaimed(false);
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
                            {bill.category} • {formatDateOnly(bill.date)}
                          </p>
                          {/* Substantiating is the common errand on this list,
                              so it gets its own control rather than sitting one
                              page-load away. stopPropagation because the row
                              itself still opens the full detail page. */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubstantiateId(bill.id);
                            }}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
                            Substantiate
                          </Button>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            ${Number(bill.amount).toFixed(2)}
                          </p>
                          {/* The "Fully Paid / Partially Paid / Unpaid" badge
                              and the "Auto-matched" badge both came off the
                              payments table and went with it (2026-08-21).
                              The first would have marked every expense
                              "Unpaid" in red once that table was empty, which
                              is the opposite of the truth — the money is gone,
                              that is why the expense exists. What the row
                              needs to say is how close this is to being money
                              back, so it says that instead. */}
                          <div className="flex items-center gap-1 justify-end mt-1">
                            {(bill.claim_state ?? "unclaimed") !==
                            "unclaimed" ? (
                              <Badge
                                variant="outline"
                                className="bg-muted text-muted-foreground"
                              >
                                {bill.claim_state === "reimbursed" ||
                                bill.claim_state === "reimbursed_externally"
                                  ? "Reimbursed"
                                  : bill.claim_state === "not_reimbursable"
                                    ? "HSA card"
                                    : "In a claim"}
                              </Badge>
                            ) : bill.eligibility_state === "eligible" ? (
                              <Badge
                                variant="outline"
                                className="bg-primary/10 text-primary border-primary/20"
                              >
                                Ready to claim
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                              >
                                Needs work
                              </Badge>
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

        <SubstantiateDialog
          expenseId={substantiateId}
          open={substantiateId !== null}
          onOpenChange={(next) => {
            if (!next) setSubstantiateId(null);
            // Amounts, eligibility and documentation may all have moved while
            // the dialog was open, so the list behind it is refetched on close
            // rather than left showing stale badges.
            if (!next) void refetchBills();
          }}
        />
      </div>
    </Shell>
  );
};

export default Bills;
