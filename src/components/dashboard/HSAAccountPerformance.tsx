import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Wallet, TrendingUp, DollarSign } from "lucide-react";
import { formatHSAAccountDateRange } from "@/lib/hsaAccountUtils";
import { Badge } from "@/components/ui/badge";
import { GenericSkeleton } from "@/components/skeletons/GenericSkeleton";

export function HSAAccountPerformance() {
  const { accounts, isLoading: accountsLoading } = useHSAAccounts();

  const { data: accountStats, isLoading: statsLoading } = useQuery({
    queryKey: ["hsa-account-stats"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const accountIds = accounts.map((a) => a.id);

      // Fetch all data in parallel (3 queries total instead of 3*N)
      const [
        { data: allInvoices },
        { data: allPayments },
        { data: allSplits },
      ] = await Promise.all([
        supabase
          .from("invoices")
          .select("amount, is_reimbursed, hsa_account_id")
          .eq("user_id", user.id)
          .in("hsa_account_id", accountIds),
        supabase
          .from("payment_transactions")
          .select("amount, hsa_account_id")
          .eq("user_id", user.id)
          .in("hsa_account_id", accountIds),
        supabase
          .from("transaction_splits")
          .select("amount, hsa_account_id")
          .in("hsa_account_id", accountIds),
      ]);

      // Group data by account ID and calculate stats
      const stats = accounts.map((account) => {
        const invoices = (allInvoices || []).filter(
          (inv) => inv.hsa_account_id === account.id,
        );
        const payments = (allPayments || []).filter(
          (p) => p.hsa_account_id === account.id,
        );
        const splits = (allSplits || []).filter(
          (s) => s.hsa_account_id === account.id,
        );

        const totalExpenses = invoices.reduce(
          (sum, inv) => sum + Number(inv.amount),
          0,
        );
        const reimbursed = invoices
          .filter((inv) => inv.is_reimbursed)
          .reduce((sum, inv) => sum + Number(inv.amount), 0);
        const unreimbursed = totalExpenses - reimbursed;
        const paymentsTotal = payments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );
        const splitsTotal = splits.reduce(
          (sum, s) => sum + Number(s.amount),
          0,
        );

        return {
          account,
          totalExpenses,
          reimbursed,
          unreimbursed,
          paymentsTotal,
          splitsTotal,
          taxSavings: totalExpenses * 0.22, // Assuming 22% tax bracket
        };
      });

      return stats;
    },
    enabled: accounts.length > 0,
  });

  if (accountsLoading || statsLoading) {
    return <GenericSkeleton className="h-[300px]" />;
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            HSA Account Performance
          </CardTitle>
          <CardDescription>
            No HSA accounts configured. Add one in Settings to track
            performance.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          HSA Account Performance
        </CardTitle>
        <CardDescription>
          Overview of your HSA accounts and their usage
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {accountStats?.map(
            ({
              account,
              totalExpenses,
              unreimbursed,
              taxSavings,
              splitsTotal: _splitsTotal,
            }) => (
              <div
                key={account.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/20"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{account.account_name}</h4>
                    {account.is_active && (
                      <Badge variant="secondary" className="text-xs">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatHSAAccountDateRange(account)}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-6 text-right">
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      ${totalExpenses.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                      <DollarSign className="h-3 w-3" />
                      Total Expenses
                    </div>
                  </div>

                  <div>
                    <div className="text-2xl font-bold text-orange-500">
                      ${unreimbursed.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Unreimbursed
                    </div>
                  </div>

                  <div>
                    <div className="text-2xl font-bold text-emerald-500">
                      ${taxSavings.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Tax Savings
                    </div>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
