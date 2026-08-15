import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { logError } from "@/utils/errorHandler";
import {
  AdvancedFilters,
  type FilterCriteria,
} from "@/components/transactions/AdvancedFilters";

interface Transaction {
  id: string;
  transaction_date: string;
  vendor: string | null;
  amount: number;
  description: string;
  category: string | null;
  payment_method_id: string | null;
  is_hsa_eligible: boolean | null;
  payment_methods?: {
    is_hsa_account: boolean;
  } | null;
}

interface LinkedTransaction extends Transaction {
  payment_transaction_id: string;
  payment_source: string;
  auto_linked?: boolean | null;
  match_confidence?: number | null;
}

interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  total_amount: number | null;
  date: string;
}

// `isLinked` is a literal discriminant, not a plain boolean: it is the only
// thing that tells the two row shapes apart, and the linked-only fields
// (payment_transaction_id, payment_source, auto_linked, match_confidence)
// are read behind `isLinked` checks.
type DisplayTransaction =
  | (Transaction & { isLinked: false })
  | (LinkedTransaction & { isLinked: true });

interface LinkTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
  onSuccess: () => void;
}

export function LinkTransactionDialog({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}: LinkTransactionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [allTransactions, setAllTransactions] = useState<DisplayTransaction[]>(
    [],
  );
  const [toggling, setToggling] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [advancedFilters, setAdvancedFilters] = useState<FilterCriteria>({});

  useEffect(() => {
    if (open && invoice) {
      fetchTransactions();
    } else {
      setAllTransactions([]);
      setSearchQuery("");
      setAdvancedFilters({});
    }
  }, [open, invoice]);

  const fetchTransactions = async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch linked transactions for this invoice
      const { data: linkedPayments, error: linkedError } = await supabase
        .from("payment_transactions")
        .select(
          `
          id,
          transaction_id,
          payment_source,
          auto_linked,
          match_confidence,
          transactions (
            id,
            transaction_date,
            vendor,
            amount,
            description,
            category,
            is_hsa_eligible,
            payment_method_id,
            payment_methods (
              is_hsa_account
            )
          )
        `,
        )
        .eq("invoice_id", invoice.id)
        .not("transaction_id", "is", null);

      if (linkedError) throw linkedError;

      const linked: LinkedTransaction[] = (linkedPayments || [])
        .filter((pt) => pt.transactions)
        .map((pt) => ({
          ...(pt.transactions as Transaction),
          payment_transaction_id: pt.id,
          payment_source: pt.payment_source,
          auto_linked: pt.auto_linked,
          match_confidence: pt.match_confidence,
        }));

      // Fetch all linked transaction IDs to exclude from unlinked list
      const { data: allLinkedTransactions } = await supabase
        .from("payment_transactions")
        .select("transaction_id")
        .not("transaction_id", "is", null);

      const linkedIds =
        allLinkedTransactions?.map((pt) => pt.transaction_id) || [];

      // Fetch unlinked transactions
      const query = supabase
        .from("transactions")
        .select(
          `
          *,
          payment_methods (
            is_hsa_account
          )
        `,
        )
        .eq("user_id", user.id)
        .is("invoice_id", null)
        .order("transaction_date", { ascending: false });

      if (linkedIds.length > 0) {
        query.not("id", "in", `(${linkedIds.join(",")})`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Combine both lists, marking which are linked
      const combined: DisplayTransaction[] = [
        ...linked.map((t) => ({ ...t, isLinked: true as const })),
        ...(data || []).map((t) => ({ ...t, isLinked: false as const })),
      ];

      setAllTransactions(combined);
    } catch (error) {
      logError("Error fetching transactions", error);
      toast.error("Failed to load transactions");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTransaction = async (transaction: DisplayTransaction) => {
    if (!invoice) return;

    setToggling(transaction.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (transaction.isLinked) {
        // Unlink the transaction
        const { error: deleteError } = await supabase
          .from("payment_transactions")
          .delete()
          .eq("id", transaction.payment_transaction_id);

        if (deleteError) throw deleteError;

        const { error: updateError } = await supabase
          .from("transactions")
          .update({
            invoice_id: null,
            reconciliation_status: "unlinked",
          })
          .eq("id", transaction.id);

        if (updateError) throw updateError;

        toast.success("Transaction unlinked from bill");
      } else {
        // Link the transaction
        const { error: paymentError } = await supabase
          .from("payment_transactions")
          .insert({
            invoice_id: invoice.id,
            transaction_id: transaction.id,
            user_id: user.id,
            payment_date: transaction.transaction_date,
            amount: transaction.amount,
            payment_source: "out_of_pocket" as const,
            notes: `Linked from transaction: ${transaction.description}`,
          });

        if (paymentError) throw paymentError;

        const { error: transactionError } = await supabase
          .from("transactions")
          .update({
            invoice_id: invoice.id,
            reconciliation_status: "linked_to_invoice",
          })
          .eq("id", transaction.id);

        if (transactionError) throw transactionError;

        // Learn vendor alias if names differ
        const txnVendor = (transaction.vendor || transaction.description || "")
          .toLowerCase()
          .trim();
        const invVendor = invoice.vendor.toLowerCase().trim();
        if (
          txnVendor &&
          invVendor &&
          txnVendor !== invVendor &&
          !txnVendor.includes(invVendor) &&
          !invVendor.includes(txnVendor)
        ) {
          await supabase.from("vendor_aliases").upsert(
            {
              user_id: user.id,
              canonical_vendor: invoice.vendor,
              alias: transaction.vendor || transaction.description,
              source: "learned",
            },
            { onConflict: "user_id,canonical_vendor,alias" },
          );
        }

        toast.success("Transaction linked to bill");
      }

      fetchTransactions();
      onSuccess();
    } catch (error) {
      logError("Error toggling transaction", error);
      toast.error("Failed to update transaction");
    } finally {
      setToggling(null);
    }
  };

  const getSimilarityScore = (transaction: Transaction): number => {
    if (!invoice) return 0;

    let score = 0;

    // Amount similarity (within 10%)
    const amountDiff = Math.abs(
      transaction.amount - (invoice.total_amount || invoice.amount),
    );
    const amountThreshold = (invoice.total_amount || invoice.amount) * 0.1;
    if (amountDiff <= amountThreshold) score += 40;

    // Vendor similarity
    const transactionVendor = (
      transaction.vendor || transaction.description
    ).toLowerCase();
    const invoiceVendor = invoice.vendor.toLowerCase();
    if (
      transactionVendor.includes(invoiceVendor) ||
      invoiceVendor.includes(transactionVendor)
    ) {
      score += 40;
    }

    // Date proximity (within 7 days)
    const transactionDate = new Date(transaction.transaction_date);
    const invoiceDate = new Date(invoice.date);
    const daysDiff = Math.abs(
      (transactionDate.getTime() - invoiceDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (daysDiff <= 7) score += 20;

    return score;
  };

  const applyFilters = (
    transactions: DisplayTransaction[],
  ): DisplayTransaction[] => {
    let filtered = [...transactions];

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

    // Apply HSA eligibility filter
    if (
      advancedFilters.isHsaEligible &&
      advancedFilters.isHsaEligible !== "all"
    ) {
      filtered = filtered.filter((t) => {
        if (advancedFilters.isHsaEligible === "yes") {
          return t.is_hsa_eligible === true;
        }
        if (advancedFilters.isHsaEligible === "no") {
          return t.is_hsa_eligible === false;
        }
        return true;
      });
    }

    return filtered;
  };

  const filteredTransactions = applyFilters(allTransactions);

  // Sort by linked status first (linked at top), then by similarity score
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    // First sort by linked status
    if (a.isLinked && !b.isLinked) return -1;
    if (!a.isLinked && b.isLinked) return 1;
    // Then by similarity score
    return getSimilarityScore(b) - getSimilarityScore(a);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Link Transactions to Bill</DialogTitle>
          <DialogDescription>
            Select transactions to link to <strong>{invoice?.vendor}</strong> (
            ${(invoice?.total_amount || invoice?.amount || 0).toFixed(2)})
          </DialogDescription>
        </DialogHeader>

        {/* Search and Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by vendor, description, or amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <AdvancedFilters
            onFilterChange={setAdvancedFilters}
            activeFilters={advancedFilters}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : sortedTransactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery || Object.keys(advancedFilters).length > 0
              ? "No transactions match your filters"
              : "No transactions available"}
          </div>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-4">
            <div className="space-y-2">
              {sortedTransactions.map((transaction) => {
                const isLinked = transaction.isLinked;
                const similarityScore = getSimilarityScore(transaction);
                const isHighMatch = similarityScore >= 60;

                return (
                  <div
                    key={transaction.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      isLinked
                        ? "bg-accent/50 border-primary/50"
                        : "hover:bg-accent/30"
                    }`}
                  >
                    <Checkbox
                      checked={isLinked}
                      onCheckedChange={() =>
                        handleToggleTransaction(transaction)
                      }
                      disabled={toggling === transaction.id}
                      id={`transaction-${transaction.id}`}
                    />
                    <label
                      htmlFor={`transaction-${transaction.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium">
                              {transaction.vendor || transaction.description}
                            </p>
                            {isLinked && (
                              <>
                                {transaction.auto_linked ? (
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20"
                                  >
                                    Auto-matched
                                    {transaction.match_confidence
                                      ? ` (${Math.round(transaction.match_confidence * 100)}%)`
                                      : ""}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Linked
                                  </Badge>
                                )}
                                {transaction.payment_source === "hsa" && (
                                  <Badge variant="success" className="text-xs">
                                    Paid via HSA
                                  </Badge>
                                )}
                              </>
                            )}
                            {!isLinked &&
                              transaction.payment_methods?.is_hsa_account && (
                                <Badge variant="success" className="text-xs">
                                  Paid via HSA
                                </Badge>
                              )}
                            {!isLinked && isHighMatch && (
                              <Badge variant="secondary" className="text-xs">
                                Likely Match
                              </Badge>
                            )}
                            {!isLinked &&
                              transaction.is_hsa_eligible &&
                              !transaction.payment_methods?.is_hsa_account && (
                                <Badge className="bg-primary/10 text-primary text-xs">
                                  HSA Eligible
                                </Badge>
                              )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {new Date(
                              transaction.transaction_date,
                            ).toLocaleDateString()}{" "}
                            • {transaction.category || "Uncategorized"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">
                            ${transaction.amount.toFixed(2)}
                          </p>
                          {toggling === transaction.id && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
