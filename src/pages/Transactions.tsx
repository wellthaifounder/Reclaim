import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Plus, Search, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { TransactionDetailDialog } from "@/components/transactions/TransactionDetailDialog";
import { TransactionInlineDetail } from "@/components/transactions/TransactionInlineDetail";
import { QuickAddTransactionDialog } from "@/components/transactions/QuickAddTransactionDialog";
import { ReviewQueue } from "@/components/transactions/ReviewQueue";
import {
  AdvancedFilters,
  type FilterCriteria,
} from "@/components/transactions/AdvancedFilters";
import { TransactionSplitDialog } from "@/components/transactions/TransactionSplitDialog";
import { SplitTransactionCard } from "@/components/transactions/SplitTransactionCard";
import { useTransactionSplits } from "@/hooks/useTransactionSplits";
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

type Transaction = {
  id: string;
  user_id: string;
  transaction_date: string;
  vendor: string | null;
  amount: number;
  description: string;
  category: string;
  is_medical: boolean;
  reconciliation_status: "unlinked" | "linked_to_invoice" | "ignored";
  is_hsa_eligible: boolean;
  needs_review: boolean;
  notes: string | null;
  payment_method_id: string | null;
  invoice_id: string | null;
  is_split: boolean;
  split_parent_id: string | null;
  plaid_transaction_id: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
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
    } else if (activeTab === "needs-review") {
      filtered = filtered.filter((t) => t.needs_review);
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

      // Check if transaction is before HSA opened date
      let isHsaEligible = newIsMedical;
      if (newIsMedical && hsaOpenedDate) {
        const transactionDate = new Date(transaction.transaction_date);
        const hsaDate = new Date(hsaOpenedDate);
        if (transactionDate < hsaDate) {
          isHsaEligible = false;
          toast.warning(
            `This transaction occurred before your HSA was opened (${new Date(hsaOpenedDate).toLocaleDateString()}). It's marked as medical but not HSA-eligible.`,
          );
        }
      }

      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: newIsMedical,
          is_hsa_eligible: isHsaEligible,
          category: newIsMedical ? "medical" : transaction.category,
          reconciliation_status: newIsMedical ? "unlinked" : "ignored",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success(
        newIsMedical ? "Marked as medical expense" : "Marked as non-medical",
      );
      fetchTransactions();
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
          is_hsa_eligible: true,
          category: "medical",
        })
        .eq("id", transaction.id);

      if (error) throw error;
      toast.success("Marked as medical expense");
      fetchTransactions();
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

  const handleConfirmMedical = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: true,
          is_hsa_eligible: true,
          needs_review: false,
          category: "medical",
        })
        .eq("id", transaction.id);
      if (error) throw error;

      // Save vendor preference so future syncs don't flag this vendor
      if (transaction.vendor) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("user_vendor_preferences").upsert(
            {
              user_id: user.id,
              vendor_pattern: transaction.vendor,
              is_medical: true,
            },
            { onConflict: "user_id,vendor_pattern" },
          );
        }
      }

      toast.success("Confirmed as medical expense");
      fetchTransactions();
    } catch (error) {
      logError("Error confirming medical transaction:", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleRejectMedical = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: false,
          is_hsa_eligible: false,
          needs_review: false,
          reconciliation_status: "ignored",
        })
        .eq("id", transaction.id);
      if (error) throw error;

      // Save vendor preference so future syncs skip this vendor
      if (transaction.vendor) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("user_vendor_preferences").upsert(
            {
              user_id: user.id,
              vendor_pattern: transaction.vendor,
              is_medical: false,
            },
            { onConflict: "user_id,vendor_pattern" },
          );
        }
      }

      toast.success("Marked as non-medical");
      fetchTransactions();
    } catch (error) {
      logError("Error rejecting medical categorization:", error);
      toast.error("Failed to update transaction");
    }
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

  const stats = {
    total: transactions.length,
    medical: transactions.filter((t) => t.is_medical).length,
    unlinked: transactions.filter((t) => t.reconciliation_status === "unlinked")
      .length,
    needsReview: transactions.filter((t) => t.needs_review).length,
    totalAmount: transactions.reduce((sum, t) => sum + Number(t.amount), 0),
    medicalAmount: transactions
      .filter((t) => t.is_medical)
      .reduce((sum, t) => sum + Number(t.amount), 0),
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
              <TabsTrigger value="review">
                Review Queue {stats.unlinked > 0 && `(${stats.unlinked})`}
              </TabsTrigger>
              <TabsTrigger value="needs-review" className="relative">
                Needs Review
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
              <ReviewQueue />
            </TabsContent>

            <TabsContent value="needs-review" className="space-y-3">
              {filteredTransactions.length === 0 ? (
                <Card className="p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    All transactions have been reviewed
                  </p>
                </Card>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    These transactions were auto-detected as medical but need
                    your confirmation to become HSA-eligible.
                  </p>
                  {filteredTransactions.map((transaction) => (
                    <Card
                      key={transaction.id}
                      className="p-4 border-yellow-200 dark:border-yellow-800"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {transaction.vendor || transaction.description}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(
                              transaction.transaction_date,
                            ).toLocaleDateString()}{" "}
                            · ${Number(transaction.amount).toFixed(2)}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-600 border-green-300 hover:bg-green-50"
                            onClick={() => handleConfirmMedical(transaction)}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Medical
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-300 hover:bg-red-50"
                            onClick={() => handleRejectMedical(transaction)}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Not Medical
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}
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
                          isMedical={transaction.is_medical}
                          reconciliationStatus={
                            transaction.reconciliation_status
                          }
                          isHsaEligible={transaction.is_hsa_eligible}
                          isFromHsaAccount={
                            transaction.payment_methods?.is_hsa_account || false
                          }
                          isSplit={transaction.is_split}
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
