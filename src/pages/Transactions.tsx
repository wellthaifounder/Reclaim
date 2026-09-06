import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAttentionItems } from "@/hooks/useAttentionItems";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Search, ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  TransactionCard,
  type TransactionCardProps,
} from "@/components/transactions/TransactionCard";
import { TransactionInlineDetail } from "@/components/transactions/TransactionInlineDetail";
import { ReviewFeed } from "@/components/transactions/ReviewFeed";
import { DuplicateWarnings } from "@/components/transactions/DuplicateWarnings";
import {
  AdvancedFilters,
  type FilterCriteria,
} from "@/components/transactions/AdvancedFilters";
import { TransactionSplitDialog } from "@/components/transactions/TransactionSplitDialog";
import { ExpenseSplitDialog } from "@/components/transactions/ExpenseSplitDialog";
import {
  CreateRulePrompt,
  type RuleCandidate,
} from "@/components/transactions/CreateRulePrompt";
import { canSplitIntoExpenses } from "@/lib/expenseSplitUtils";
import { SplitTransactionCard } from "@/components/transactions/SplitTransactionCard";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import Bills from "@/pages/Bills";
import { MissingHSADateBanner } from "@/components/dashboard/MissingHSADateBanner";
import { TransactionsSkeleton } from "@/components/skeletons/TransactionsSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { logError } from "@/utils/errorHandler";
import { formatCurrency } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

// Derived from the generated row type rather than hand-written. The previous
// hand-written copy had drifted: it declared category/is_medical/needs_review
// as non-null when the DB allows null, and predated plaid_account_id and
// signed_amount, so it silently disagreed with every child that takes a row.
// The HSA flag comes from the account the charge landed on, not from a
// hand-maintained "payment method" record (2026-08-21). See fetchTransactions.
type Transaction = Database["public"]["Tables"]["transactions"]["Row"] & {
  plaid_accounts?: {
    is_hsa: boolean | null;
  } | null;
};

export default function Transactions() {
  const queryClient = useQueryClient();
  // The one source of truth for "how many need review", read by the tab
  // badge, the stat card, and (via AuthenticatedLayout) the sidebar/top-nav
  // badge. Every mutation below that can change needs_review invalidates
  // this query, so all three stay in sync with each other and with the
  // review feed's own bulk-decide actions -- which this page's local
  // `transactions` state never learns about on its own.
  //
  // This used to be `spending.filter(t => t.needs_review).length`, computed
  // from that same local state and read by all three of the badges above --
  // which is exactly why deciding a merchant through the review feed left
  // them all stale, since that RPC never touches this page's own fetch.
  // (Do not reach for `reconciliation_status === "unlinked"` as a substitute
  // count either: plaidSync.ts stamps that on every row at ingest, so it
  // always equals total volume and means "no expense attached yet," not "a
  // human still has to decide" -- which is how a fully-sorted account once
  // reported "48 need review" directly above "Nothing to review".)
  const { unreviewedTransactions: liveNeedsReview } = useAttentionItems();
  const invalidateAttentionItems = () =>
    queryClient.invalidateQueries({ queryKey: ["attention-items"] });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<
    Transaction[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTransactionId, setExpandedTransactionId] = useState<
    string | null
  >(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [transactionToSplit, setTransactionToSplit] =
    useState<Transaction | null>(null);
  // Workstream B3: splitting a transaction into several EXPENSES is a
  // different operation from TransactionSplitDialog's split across HSA
  // accounts, so it gets its own dialog and its own state.
  const [expenseSplitOpen, setExpenseSplitOpen] = useState(false);
  const [txnToExpenseSplit, setTxnToExpenseSplit] =
    useState<Transaction | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Workstream C3: set after a categorization decision, to offer a rule.
  const [ruleCandidate, setRuleCandidate] = useState<RuleCandidate | null>(
    null,
  );
  // ?tab= opens a specific tab. The dashboard has linked to
  // /transactions?tab=review for a while, but nothing here ever read the
  // parameter, so "Review transactions" quietly dropped people on the All tab
  // instead of the queue they asked for. Kept in the URL rather than state
  // alone so the tab survives a refresh and can be linked to.
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ["review", "all", "medical", "non-medical", "to-claim"];
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab && TABS.includes(requestedTab) ? requestedTab : "all";

  const setActiveTab = (next: string) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "all") sp.delete("tab");
    else sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  };
  const [advancedFilters, setAdvancedFilters] = useState<FilterCriteria>({});
  const [hsaOpenedDate, setHsaOpenedDate] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
    fetchHSADate();
  }, []);

  const fetchHSADate = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("hsa_opened_date")
        .eq("id", user.id)
        .maybeSingle();

      if (error) logError("No profile found or error fetching profile", error);
      setHsaOpenedDate(profile?.hsa_opened_date || null);
    } catch (e) {
      logError("fetchHSADate failed", e);
      setHsaOpenedDate(null);
    }
  };

  useEffect(() => {
    filterTransactions();
  }, [transactions, searchQuery, activeTab, advancedFilters]);

  // Open on the review queue when there is something waiting -- but only as a
  // first-load default, and only when the URL did not ask for a tab.
  //
  // Guarded by a ref because the tab now lives in the URL. Without it, this
  // fires again the moment a user with unreviewed transactions clicks "All"
  // and snaps them straight back to Review, which reads as the tab being
  // broken. It must also lose to an explicit ?tab= so a link to a particular
  // tab actually lands there.
  const autoTabDone = useRef(false);
  useEffect(() => {
    if (autoTabDone.current) return;
    if (searchParams.get("tab")) {
      autoTabDone.current = true;
      return;
    }
    if (transactions.length === 0) return;

    autoTabDone.current = true;
    const unlinked = transactions.filter(
      (t) => t.reconciliation_status === "unlinked",
    ).length;
    if (unlinked > 0) setActiveTab("review");
    // setActiveTab is recreated each render (it writes to the URL) and
    // including it would re-run this on every navigation, defeating the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, searchParams]);

  const checkAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    fetchTransactions();
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      // "Paid with the HSA card" was reading the wrong table (2026-08-21).
      //
      // This joined `payment_methods`, a list the user typed in by hand on a
      // settings screen. Bank sync never fills `payment_method_id` -- it fills
      // `plaid_account_id` -- so on every imported transaction the join came
      // back empty and the "HSA card" badge never appeared, no matter which
      // card paid.
      //
      // That badge is not decoration. Money spent straight from the HSA card
      // has already had its tax break; claiming it again is the double-dip the
      // IRS cares most about. The sync itself has always had this right --
      // it reads `plaid_accounts.is_hsa` and marks those expenses
      // not_reimbursable at capture -- so the ledger was correct while the
      // screen said otherwise. Now they read the same column.
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          *,
          plaid_accounts (
            is_hsa
          )
        `,
        )
        .order("transaction_date", { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      logError("Error fetching transactions:", error);
      toast.error("Failed to load transactions");
    } finally {
      setLoading(false);
    }
  };

  const filterTransactions = () => {
    let filtered = [...transactions];

    // Filter by tab
    if (activeTab === "medical") {
      filtered = filtered.filter((t) => t.is_medical);
    } else if (activeTab === "non-medical") {
      filtered = filtered.filter((t) => t.is_medical === false);
    } else if (activeTab === "all") {
      // Show all transactions including ignored ones
      // No filtering needed
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.vendor?.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.amount.toString().includes(query),
      );
    }

    // Apply advanced filters
    if (advancedFilters.amountOperator) {
      const { amountOperator, amountMin, amountMax } = advancedFilters;
      filtered = filtered.filter((t) => {
        const amount = Number(t.amount);
        if (amountOperator === "gt" && amountMin !== undefined) {
          return amount > amountMin;
        }
        if (amountOperator === "lt" && amountMin !== undefined) {
          return amount < amountMin;
        }
        if (amountOperator === "equal" && amountMin !== undefined) {
          return Math.abs(amount - amountMin) < 0.01;
        }
        if (
          amountOperator === "between" &&
          amountMin !== undefined &&
          amountMax !== undefined
        ) {
          return amount >= amountMin && amount <= amountMax;
        }
        return true;
      });
    }

    if (advancedFilters.dateOperator && advancedFilters.dateStart) {
      const { dateOperator, dateStart, dateEnd } = advancedFilters;
      filtered = filtered.filter((t) => {
        const transactionDate = new Date(t.transaction_date);
        const startDate = new Date(dateStart);

        if (dateOperator === "after") {
          return transactionDate > startDate;
        }
        if (dateOperator === "before") {
          return transactionDate < startDate;
        }
        if (dateOperator === "on") {
          return transactionDate.toDateString() === startDate.toDateString();
        }
        if (dateOperator === "between" && dateEnd) {
          const endDate = new Date(dateEnd);
          return transactionDate >= startDate && transactionDate <= endDate;
        }
        return true;
      });
    }

    setFilteredTransactions(filtered);
  };

  const handleViewDetails = (transaction: Transaction) => {
    if (expandedTransactionId === transaction.id) {
      setExpandedTransactionId(null);
    } else {
      setExpandedTransactionId(transaction.id);
    }
  };

  const handleToggleMedical = async (transaction: Transaction) => {
    try {
      const newIsMedical = !transaction.is_medical;

      // Workstream C2: no is_hsa_eligible here, and no HSA-establishment-date
      // warning. Both decided eligibility at categorization, which is the
      // wrong step -- eligibility needs date of service, patient and Pub 502
      // category, none of which are known from a bank transaction. The
      // establishment-date gate is reported during substantiation instead.
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: newIsMedical,
          needs_review: false,
          category: newIsMedical ? "medical" : transaction.category,
          reconciliation_status: newIsMedical ? "unlinked" : "ignored",
          classification_reason: "user",
          classification_explanation: newIsMedical
            ? "You confirmed this as a medical expense."
            : "You marked this as not medical.",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success(
        newIsMedical ? "Marked as medical expense" : "Marked as non-medical",
      );
      fetchTransactions();
      invalidateAttentionItems();
      // Workstream C4: rules are reachable from any transaction, including
      // ones already filed in the archive -- that is how a user corrects a
      // vendor they disagree with rather than fixing rows one by one.
      setRuleCandidate({ ...transaction, isMedical: newIsMedical });
    } catch (error) {
      logError("Error toggling medical:", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleMarkMedical = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: true,
          needs_review: false,
          category: "medical",
          classification_reason: "user",
          classification_explanation:
            "You confirmed this as a medical expense.",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Marked as medical expense");
      fetchTransactions();
      invalidateAttentionItems();
      setRuleCandidate({ ...transaction, isMedical: true });
    } catch (error) {
      logError("Error updating transaction:", error);
      toast.error("Failed to update transaction");
    }
  };

  // "Link to a bill" removed 2026-08-21.
  //
  // It opened a picker of every expense on file and let the user attach this
  // transaction to one of them, recording the attachment in a second payment
  // table. That is a document hunting for its own transaction, which the
  // workflow spec defers past v1 -- and it competed with the link the sync
  // already makes for itself when it turns a medical transaction into an
  // expense. Two links, written by different code, that could disagree.

  const handleIgnore = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          reconciliation_status: "ignored",
          is_medical: false,
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Transaction ignored");
      fetchTransactions();
    } catch (error) {
      logError("Error ignoring transaction:", error);
      toast.error("Failed to ignore transaction");
    }
  };

  const handleUnignore = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          reconciliation_status: "unlinked",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Transaction moved back to review queue");
      fetchTransactions();
    } catch (error) {
      logError("Error unignoring transaction:", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleAddToReviewQueue = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          reconciliation_status: "unlinked",
          is_medical: false,
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Transaction added back to review queue");
      fetchTransactions();
    } catch (error) {
      logError("Error adding to review queue:", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleSplitTransaction = (transaction: Transaction) => {
    setTransactionToSplit(transaction);
    setSplitDialogOpen(true);
  };

  // Workstream B3. Distinct from handleSplitTransaction above, which splits a
  // transaction across HSA accounts for allocation. This splits it into
  // separate EXPENSES — the mixed-basket case ($12 of Tylenol in an $87
  // Walmart run) and the bundled-payment case (one hospital charge covering
  // several visits for different family members).
  const handleUnlinkTransfer = async (transaction: Transaction) => {
    try {
      const { error } = await supabase.rpc("unlink_transfer", {
        p_transaction_id: transaction.id,
      });
      if (error) throw error;
      // Both halves come back, so say so — the user clicked on one row but two
      // reappear in the review queue.
      toast.success("Transfer undone. Both transactions are back for review.");
      fetchTransactions();
      invalidateAttentionItems();
    } catch (error) {
      logError("Error unlinking transfer:", error);
      toast.error("Failed to undo the transfer");
    }
  };

  const handleSplitIntoExpenses = (transaction: Transaction) => {
    const check = canSplitIntoExpenses(transaction);
    if (!check.canSplit) {
      toast.error(check.reason ?? "This transaction can't be split.");
      return;
    }
    setTxnToExpenseSplit(transaction);
    setExpenseSplitOpen(true);
  };

  // Workstream C5: transfers are excluded from every total. Moving $500 from
  // checking to a credit card is not $1,000 of spending, and counting it as
  // any spending at all is what makes the app's own numbers visibly wrong.
  const spending = transactions.filter((t) => !t.is_transfer);
  const cardPayments = transactions.filter(
    (t) => t.transfer_kind === "card_payment",
  );

  // "Medical" means CONFIRMED medical. The classifier sets is_medical=true at
  // the same time as needs_review=true for anything it thinks is medical but
  // wants a human to confirm, so filtering on is_medical alone counts money the
  // user has not agreed to yet. On the seeded account that read "Medical
  // $15,109.32" directly above a queue of 27 undecided transactions worth
  // $8,194.32 -- 54% of the figure -- so the same screen called those charges
  // decided and undecided at once. Confirmed and pending are now separate.
  const confirmedMedical = spending.filter(
    (t) => t.is_medical && !t.needs_review,
  );
  const pendingMedical = spending.filter((t) => t.is_medical && t.needs_review);

  const stats = {
    total: spending.length,
    medical: confirmedMedical.length,
    totalAmount: spending.reduce((sum, t) => sum + Number(t.amount), 0),
    medicalAmount: confirmedMedical.reduce(
      (sum, t) => sum + Number(t.amount),
      0,
    ),
    pendingMedicalAmount: pendingMedical.reduce(
      (sum, t) => sum + Number(t.amount),
      0,
    ),
    transfers: transactions.length - spending.length,
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <TransactionsSkeleton />
      </AuthenticatedLayout>
    );
  }

  return (
    <ErrorBoundary
      fallbackTitle="Transactions Error"
      fallbackDescription="We encountered an error loading your transactions. Your data is safe. Please try again."
      onReset={() => {
        setLoading(true);
        fetchTransactions();
      }}
    >
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {!hsaOpenedDate && <MissingHSADateBanner onDateSet={fetchHSADate} />}

          {/* Workstream C5. The spec asks for this warning explicitly: a card
              payment is not a reimbursable expense, and users who reimburse it
              instead of the underlying charges either double-claim or claim
              something that was never a medical purchase. */}
          {cardPayments.length > 0 && (
            <Alert className="mb-6">
              <ArrowLeftRight className="h-4 w-4" />
              <AlertTitle>
                Credit card payments aren&rsquo;t expenses
              </AlertTitle>
              <AlertDescription>
                We found {cardPayments.length} payment
                {cardPayments.length === 1 ? "" : "s"} to your credit card and
                left {cardPayments.length === 1 ? "it" : "them"} out of your
                totals. Claim the original charges on the card &mdash; the
                pharmacy, the doctor &mdash; not the payment that settles the
                balance. Claiming the payment would either double up on those
                charges or claim something that was never a medical purchase.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between sticky top-0 z-10 bg-background py-2 mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Expenses</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Decide what's medical, then get it documented and claimed
              </p>
            </div>
            {/* Was a dialog that wrote a bare transaction with no patient and
                no date of service -- the two things a claim is refused for
                lacking. It now goes to the one entry form, which asks. */}
            <Button variant="outline" onClick={() => navigate("/expenses/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Add manually
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Total Transactions
              </p>
              <p className="text-2xl font-bold text-foreground">
                {stats.total}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Medical, confirmed
              </p>
              <p className="text-2xl font-bold text-primary tabular-nums">
                {stats.medical}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Needs Review</p>
              <p className="text-2xl font-bold text-yellow-600 tabular-nums">
                {liveNeedsReview}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Confirmed total</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">
                {formatCurrency(stats.medicalAmount)}
              </p>
              {stats.pendingMedicalAmount > 0 && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {formatCurrency(stats.pendingMedicalAmount)} awaiting your
                  review
                </p>
              )}
            </Card>
          </div>

          {/* Search and Filters */}
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search by vendor, description, or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <AdvancedFilters
              onFilterChange={setAdvancedFilters}
              activeFilters={advancedFilters}
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              {/* One review tab, not two. "Review Queue" (one-at-a-time
                  swipe) and "Needs Review" (flat list) were two routes to the
                  same decision, and the flat list still told users confirming
                  a transaction made it HSA-eligible — which stopped being true
                  when eligibility moved to substantiation. */}
              <TabsTrigger value="review" className="relative">
                Review
                {liveNeedsReview > 0 && (
                  <Badge
                    variant="destructive"
                    className="ml-1.5 px-1.5 py-0 text-xs"
                  >
                    {liveNeedsReview}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="medical">Medical</TabsTrigger>
              <TabsTrigger value="non-medical">Non-Medical</TabsTrigger>
              {/* The old /bills list, merged in here 2026-08-20. The tabs to
                  its left are bank transactions -- money that moved. This one
                  is expenses: what a medical transaction became once it has a
                  service date, a patient and documents. They are different
                  objects, which is why this is a separate tab rather than
                  another filter, but both are "expenses" to the person
                  looking at them, so they share a page. */}
              <TabsTrigger value="to-claim">To claim</TabsTrigger>
            </TabsList>

            <TabsContent value="to-claim" className="space-y-4">
              <Bills embedded />
            </TabsContent>

            <TabsContent value="review" className="space-y-4">
              {/* Workstream C6. Above the categorize feed on purpose: a
                  duplicate is money already at risk, whereas an unreviewed
                  transaction is only undecided. */}
              <DuplicateWarnings />
              <ReviewFeed />
            </TabsContent>

            {/* One content block serves All / Medical / Non-Medical, keyed to
                whichever is active. "review" and "to-claim" have their own
                blocks above, so they are excluded here -- without this guard
                a `value={activeTab}` block also matches them and the page
                renders two lists at once. */}
            <TabsContent
              value={
                activeTab === "review" || activeTab === "to-claim"
                  ? "__inactive__"
                  : activeTab
              }
              className="space-y-4"
            >
              {filteredTransactions.length === 0 ? (
                <Card className="p-12 text-center">
                  <p className="text-muted-foreground">Nothing here yet</p>
                  <Button
                    onClick={() => navigate("/expenses/new")}
                    variant="outline"
                    className="mt-4"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add one manually
                  </Button>
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredTransactions.map((transaction) => {
                    // Show split transaction card for split transactions
                    if (transaction.is_split) {
                      return (
                        <SplitTransactionCard
                          key={transaction.id}
                          transaction={transaction}
                        />
                      );
                    }

                    return (
                      <div key={transaction.id}>
                        <TransactionCard
                          id={transaction.id}
                          date={transaction.transaction_date}
                          vendor={transaction.vendor || "Unknown"}
                          amount={transaction.amount}
                          description={transaction.description}
                          isMedical={transaction.is_medical ?? false}
                          reconciliationStatus={
                            (transaction.reconciliation_status ??
                              "unlinked") as TransactionCardProps["reconciliationStatus"]
                          }
                          isHsaEligible={transaction.is_hsa_eligible ?? false}
                          isFromHsaAccount={
                            transaction.plaid_accounts?.is_hsa || false
                          }
                          isSplit={transaction.is_split ?? false}
                          classificationExplanation={
                            transaction.classification_explanation
                          }
                          isTransfer={transaction.is_transfer ?? false}
                          transferKind={transaction.transfer_kind}
                          onUnlinkTransfer={() =>
                            handleUnlinkTransfer(transaction)
                          }
                          invoiceId={transaction.invoice_id}
                          splitParentId={transaction.split_parent_id}
                          onViewDetails={() => handleViewDetails(transaction)}
                          onMarkMedical={() => handleMarkMedical(transaction)}
                          onToggleMedical={() =>
                            handleToggleMedical(transaction)
                          }
                          onIgnore={() => handleIgnore(transaction)}
                          onUnignore={() => handleUnignore(transaction)}
                          onAddToReviewQueue={() =>
                            handleAddToReviewQueue(transaction)
                          }
                          onSplitTransaction={() =>
                            handleSplitTransaction(transaction)
                          }
                          onSplitIntoExpenses={() =>
                            handleSplitIntoExpenses(transaction)
                          }
                        />
                        {expandedTransactionId === transaction.id && (
                          <TransactionInlineDetail
                            transaction={transaction}
                            onClose={() => setExpandedTransactionId(null)}
                            onUpdate={fetchTransactions}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* TransactionDetailDialog removed 2026-08-21: nothing had set its
            open flag since clicking a row started expanding the row in place
            instead, so it had quietly become a dialog that could not be
            opened. TransactionInlineDetail above is the live surface. */}

        {transactionToSplit && (
          <TransactionSplitDialog
            open={splitDialogOpen}
            onOpenChange={(open) => {
              setSplitDialogOpen(open);
              if (!open) {
                setTransactionToSplit(null);
                fetchTransactions();
              }
            }}
            transaction={transactionToSplit}
          />
        )}

        {txnToExpenseSplit && currentUserId && (
          <ExpenseSplitDialog
            open={expenseSplitOpen}
            onOpenChange={(open) => {
              setExpenseSplitOpen(open);
              if (!open) setTxnToExpenseSplit(null);
            }}
            transaction={txnToExpenseSplit}
            userId={currentUserId}
            onSplit={fetchTransactions}
          />
        )}

        {/* Workstream C3 — offer a rule after a categorization decision. */}
        <CreateRulePrompt
          candidate={ruleCandidate}
          onOpenChange={(open) => !open && setRuleCandidate(null)}
          onCreated={fetchTransactions}
        />
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
}
