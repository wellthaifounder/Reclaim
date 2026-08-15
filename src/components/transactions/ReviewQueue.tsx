import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SuggestionCard } from "./SuggestionCard";
import { TransactionDetailDialog } from "./TransactionDetailDialog";
import { OnboardingDialog } from "./OnboardingDialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import {
  getSuggestion,
  type Transaction as TransactionType,
  type Invoice,
} from "@/lib/transactionMatcher";
import { Loader2, PartyPopper, ArrowLeft } from "lucide-react";
import { suggestRuleKey, type MatchableRule } from "@/lib/merchantNormalize";
import confetti from "canvas-confetti";

export function ReviewQueue() {
  const [transactions, setTransactions] = useState<TransactionType[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [rules, setRules] = useState<MatchableRule[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [, setHasCompletedOnboarding] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    fetchData();
    checkOnboarding();
  }, []);

  const checkOnboarding = () => {
    const completed = localStorage.getItem("review_queue_onboarding_completed");
    if (!completed) {
      setShowOnboarding(true);
    } else {
      setHasCompletedOnboarding(true);
    }
  };

  const handleCompleteOnboarding = () => {
    localStorage.setItem("review_queue_onboarding_completed", "true");
    setShowOnboarding(false);
    setHasCompletedOnboarding(true);
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (detailsOpen) return;

      if (e.key === "m" || e.key === "M") {
        handleConfirmMedical();
      } else if (e.key === "n" || e.key === "N") {
        handleNotMedical();
      } else if (e.key === "s" || e.key === "S") {
        handleSkip();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentIndex, detailsOpen]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch unlinked transactions
      const { data: txData, error: txError } = await supabase
        .from("transactions")
        .select("*")
        .eq("reconciliation_status", "unlinked")
        .order("transaction_date", { ascending: false });

      if (txError) throw txError;

      // Fetch user's invoices for matching
      const { data: invData, error: invError } = await supabase
        .from("invoices")
        .select("id, vendor, amount, date, invoice_date")
        .is("is_reimbursed", false);

      if (invError) throw invError;

      // Workstream C3: categorization_rules replaces user_vendor_preferences.
      const { data: ruleData, error: ruleError } = await supabase
        .from("categorization_rules")
        .select("id, match_type, match_value, is_medical, display_label");

      if (ruleError) throw ruleError;

      setTransactions(txData || []);
      setInvoices(invData || []);
      setRules(ruleData || []);
    } catch (error) {
      logError("Error fetching data", error);
      toast.error("Failed to load review queue");
    } finally {
      setLoading(false);
    }
  };

  /**
   * "Remember this choice" creates a categorization rule and applies it to
   * matching past transactions. That retroactive apply is the point — the
   * user has just told us how they think about this merchant, and leaving
   * their history untouched wastes the answer.
   *
   * Unlike the old savePreference this is visible and reversible: the rule
   * appears in Settings → Categorization rules with an undo that restores
   * every transaction it touched.
   */
  const saveRule = async (transaction: TransactionType, isMedical: boolean) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const key = suggestRuleKey(transaction);
      if (!key) return;

      const { data: rule, error } = await supabase
        .from("categorization_rules")
        .upsert(
          {
            user_id: user.id,
            match_type: key.matchType,
            match_value: key.matchValue,
            is_medical: isMedical,
            display_label: transaction.vendor ?? transaction.description,
          },
          { onConflict: "user_id,match_type,match_value" },
        )
        .select("id, match_type, match_value, is_medical, display_label")
        .single();
      if (error) throw error;

      const { error: applyError } = await supabase.rpc(
        "apply_categorization_rule",
        { p_rule_id: rule.id },
      );
      if (applyError) throw applyError;

      setRules((prev) => [
        ...prev.filter((r) => r.id !== rule.id),
        rule as MatchableRule,
      ]);
    } catch (error) {
      logError("Error saving categorization rule", error);
    }
  };

  const handleConfirmMedical = async (rememberChoice?: boolean) => {
    const transaction = transactions[currentIndex];
    if (!transaction) return;

    const suggestion = getSuggestion(transaction, invoices, rules);

    try {
      // Workstream C2: no is_hsa_eligible here. Eligibility depends on date of
      // service, patient and Pub 502 category, none of which this screen knows.
      const updates: Record<string, unknown> = {
        is_medical: true,
        needs_review: false,
        reconciliation_status: "linked_to_invoice",
        classification_reason: "user",
        classification_explanation: "You confirmed this as a medical expense.",
      };

      if (suggestion.invoice) {
        updates.invoice_id = suggestion.invoice.id;
      }

      const { error } = await supabase
        .from("transactions")
        .update(updates)
        .eq("id", transaction.id);

      if (error) throw error;

      if (rememberChoice) {
        await saveRule(transaction, true);
        toast.success("Marked as medical and saved a rule for this merchant");
      } else {
        toast.success("Marked as medical expense");
      }

      moveToNext();
    } catch (error) {
      logError("Error updating transaction", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleNotMedical = async (rememberChoice?: boolean) => {
    const transaction = transactions[currentIndex];
    if (!transaction) return;

    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          is_medical: false,
          needs_review: false,
          reconciliation_status: "ignored",
          classification_reason: "user",
          classification_explanation: "You marked this as not medical.",
        })
        .eq("id", transaction.id);

      if (error) throw error;

      if (rememberChoice) {
        await saveRule(transaction, false);
        toast.success(
          "Marked as not medical and saved a rule for this merchant",
        );
      } else {
        toast.success("Marked as not medical");
      }

      moveToNext();
    } catch (error) {
      logError("Error updating transaction", error);
      toast.error("Failed to update transaction");
    }
  };

  const handleSkip = () => {
    moveToNext();
  };

  const moveToNext = () => {
    // Remove the current transaction from the list
    const updatedTransactions = transactions.filter(
      (_, idx) => idx !== currentIndex,
    );
    setTransactions(updatedTransactions);

    // If there are more transactions and we're not at the end, stay at current index
    // Otherwise show completion if no more transactions
    if (updatedTransactions.length === 0) {
      setShowCompletion(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });

      // Refresh after celebration
      setTimeout(() => {
        fetchData();
        setCurrentIndex(0);
        setShowCompletion(false);
      }, 3000);
    } else if (currentIndex >= updatedTransactions.length) {
      // If we were at the last item, go to the new last item
      setCurrentIndex(updatedTransactions.length - 1);
    }
    // Otherwise currentIndex stays the same, showing the next transaction
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showCompletion) {
    return (
      <div className="text-center py-12 space-y-6">
        <div className="flex justify-center">
          <PartyPopper className="h-24 w-24 text-primary animate-bounce" />
        </div>
        <div>
          <h3 className="text-2xl font-bold">Great job! 🎉</h3>
          <p className="text-muted-foreground mt-2">
            You've reviewed all your transactions
          </p>
          <p className="text-sm text-muted-foreground mt-4">
            Checking for more transactions...
          </p>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <h3 className="text-lg font-semibold">All caught up! 🎉</h3>
        <p className="text-muted-foreground mt-2">
          No unlinked transactions to review
        </p>
        <Button variant="outline" onClick={fetchData} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to All Transactions
        </Button>
      </div>
    );
  }

  const currentTransaction = transactions[currentIndex];
  const suggestion = getSuggestion(currentTransaction, invoices, rules);
  const progress = ((currentIndex + 1) / transactions.length) * 100;

  // Extend transaction with missing properties for dialog
  const extendedTransaction = currentTransaction
    ? {
        ...currentTransaction,
        category: currentTransaction.category || "uncategorized",
        is_hsa_eligible: currentTransaction.is_hsa_eligible || false,
        notes: currentTransaction.notes || null,
        payment_method_id: currentTransaction.payment_method_id || null,
        invoice_id: currentTransaction.invoice_id || null,
        is_medical: currentTransaction.is_medical || false,
        reconciliation_status:
          currentTransaction.reconciliation_status || "unlinked",
      }
    : null;

  return (
    <>
      <OnboardingDialog
        open={showOnboarding}
        onComplete={handleCompleteOnboarding}
      />

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Review Progress</span>
            <span className="text-muted-foreground">
              {currentIndex + 1} of {transactions.length}
            </span>
          </div>
          <Progress value={progress} />
        </div>

        {/* Suggestion Card */}
        <SuggestionCard
          transaction={currentTransaction}
          suggestion={suggestion}
          onConfirmMedical={() => handleConfirmMedical()}
          onNotMedical={() => handleNotMedical()}
          onSkip={handleSkip}
          onViewDetails={() => setDetailsOpen(true)}
          onRememberChoice={(isMedical) => {
            if (isMedical) {
              handleConfirmMedical(true);
            } else {
              handleNotMedical(true);
            }
          }}
        />

        {/* Detail Dialog */}
        {extendedTransaction && (
          <TransactionDetailDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            transaction={extendedTransaction}
            onUpdate={fetchData}
            onLinkToInvoice={() => {}}
          />
        )}
      </div>
    </>
  );
}
