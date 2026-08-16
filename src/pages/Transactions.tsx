import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { TransactionDetailDialog } from "@/components/transactions/TransactionDetailDialog";
import { TransactionInlineDetail } from "@/components/transactions/TransactionInlineDetail";
import { QuickAddTransactionDialog } from "@/components/transactions/QuickAddTransactionDialog";
import { ReviewFeed } from "@/components/transactions/ReviewFeed";
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
import { MissingHSADateBanner } from "@/components/dashboard/MissingHSADateBanner";
import { TransactionsSkeleton } from "@/components/skeletons/TransactionsSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { logError } from "@/utils/errorHandler";
import { LinkTransactionDialog } from "@/components/bills/LinkTransactionDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Database } from "@/integrations/supabase/types";

// Derived from the generated row type rather than hand-written. The previous
// hand-written copy had drifted: it declared category/is_medical/needs_review
// as non-null when the DB allows null, and predated plaid_account_id and
// signed_amount, so it silently disagreed with every child that takes a row.
type Transaction = Database["public"]["Tables"]["transactions"]["Row"] & {
  payment_methods?: {
    is_hsa_account: boolean;
  } | null;
};

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<
    Transaction[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [expandedTransactionId, setExpandedTransactionId] = useState<
    string | null
  >(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
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
  const [activeTab, setActiveTab] = useState("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterCriteria>({});
  const [hsaOpenedDate, setHsaOpenedDate] = useState<string | null>(null);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkTargetInvoice, setLinkTargetInvoice] = useState<{
    id: string;
    vendor: string;
    amount: number;
    total_amount: number;
    date: string;
  } | null>(null);
  const [availableInvoices, setAvailableInvoices] = useState<
    {
      id: string;
      vendor: string;
      amount: number;
      total_amount: number;
      date: string;
    }[]
  >([]);

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

  useEffect(() => {
    // Default to review queue if there are unlinked transactions (runs once on load)
    if (transactions.length > 0 && activeTab === "all") {
      const unlinkedCount = transactions.filter(
        (t) => t.reconciliation_status === "unlinked",
      ).length;
      if (unlinkedCount > 0) {
        setActiveTab("review");
      }
    }
  }, [transactions, activeTab]);

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
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          *,
          payment_methods (
            is_hsa_account
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
      setRuleCandidate({ ...transaction, isMedical: true });
    } catch (error) {
      logError("Error updating transaction:", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleLinkToInvoice = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, vendor, amount, total_amount, date")
        .order("date", { ascending: false })
        .limit(200);
      if (error) throw error;
      setAvailableInvoices(
        (data || []).map((inv) => ({
          id: inv.id,
          vendor: inv.vendor,
          amount: Number(inv.amount),
          total_amount: Number(inv.total_amount ?? inv.amount),
          date: inv.date,
        })),
      );
      setInvoicePickerOpen(true);
    } catch (error) {
      logError("Error loading invoices for linking:", error);
      toast.error("Failed to load bills");
    }
  };

  const handleInvoiceSelected = (invoice: {
    id: string;
    vendor: string;
    amount: number;
    total_amount: number;
    date: string;
  }) => {
    setLinkTargetInvoice(invoice);
    setInvoicePickerOpen(false);
    setLinkDialogOpen(true);
  };

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

  const stats = {
    total: spending.length,
    medical: spending.filter((t) => t.is_medical).length,
    unlinked: spending.filter((t) => t.reconciliation_status === "unlinked")
      .length,
    needsReview: spending.filter((t) => t.needs_review).length,
    totalAmount: spending.reduce((sum, t) => sum + Number(t.amount), 0),
    medicalAmount: spending
      .filter((t) => t.is_medical)
      .reduce((sum, t) => sum + Number(t.amount), 0),
    transfers: transactions.length - spending.length,
  };

  if (loading) {
    return (
      <AuthenticatedLayout unreviewedTransactions={0}>
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
      <AuthenticatedLayout unreviewedTransactions={stats.unlinked}>
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
              <h1 className="text-3xl font-bold text-foreground">
                Transactions
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Track and categorize all your financial transactions
              </p>
            </div>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Transaction
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
              <p className="text-sm text-muted-foreground">Medical</p>
              <p className="text-2xl font-bold text-primary">{stats.medical}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Needs Review</p>
              <p className="text-2xl font-bold text-yellow-600">
                {stats.unlinked}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Medical Total</p>
              <p className="text-2xl font-bold text-foreground">
                ${stats.medicalAmount.toFixed(2)}
              </p>
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
                {stats.needsReview > 0 && (
                  <Badge
                    variant="destructive"
                    className="ml-1.5 px-1.5 py-0 text-xs"
                  >
                    {stats.needsReview}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="medical">Medical</TabsTrigger>
              <TabsTrigger value="non-medical">Non-Medical</TabsTrigger>
            </TabsList>

            <TabsContent value="review" className="space-y-4">
              <ReviewFeed />
            </TabsContent>

            <TabsContent value={activeTab} className="space-y-4">
              {filteredTransactions.length === 0 ? (
                <Card className="p-12 text-center">
                  <p className="text-muted-foreground">No transactions found</p>
                  <Button
                    onClick={() => setAddDialogOpen(true)}
                    variant="outline"
                    className="mt-4"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Your First Transaction
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
                            transaction.payment_methods?.is_hsa_account || false
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
                          onLinkToInvoice={() =>
                            handleLinkToInvoice(transaction)
                          }
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

        <TransactionDetailDialog
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
          transaction={selectedTransaction}
          onUpdate={fetchTransactions}
          onLinkToInvoice={() => {
            if (selectedTransaction) {
              handleLinkToInvoice(selectedTransaction);
            }
          }}
        />

        <QuickAddTransactionDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onSuccess={fetchTransactions}
        />

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

        {/* Invoice picker — step 1 of transaction linking */}
        <Dialog open={invoicePickerOpen} onOpenChange={setInvoicePickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Select a Bill to Link</DialogTitle>
              <DialogDescription>
                Choose which bill to link this transaction to.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-80">
              <div className="space-y-2 pr-2">
                {availableInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No bills found
                  </p>
                ) : (
                  availableInvoices.map((invoice) => (
                    <button
                      key={invoice.id}
                      onClick={() => handleInvoiceSelected(invoice)}
                      className="w-full text-left p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <p className="font-medium text-sm">{invoice.vendor}</p>
                      <p className="text-xs text-muted-foreground">
                        ${invoice.total_amount.toFixed(2)} ·{" "}
                        {new Date(invoice.date).toLocaleDateString()}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Link transaction dialog — step 2 */}
        <LinkTransactionDialog
          open={linkDialogOpen}
          onOpenChange={(open) => {
            setLinkDialogOpen(open);
            if (!open) fetchTransactions();
          }}
          invoice={linkTargetInvoice}
          onSuccess={fetchTransactions}
        />
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
}
