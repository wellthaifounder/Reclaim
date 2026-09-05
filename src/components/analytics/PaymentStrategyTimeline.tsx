import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Calendar, DollarSign } from "lucide-react";

interface TimelineExpense {
  id: string;
  date: string;
  vendor: string;
  amount: number;
  card_payoff_months: number;
  planned_reimbursement_date: string | null;
  reimbursement_strategy: string;
}

interface PaymentStrategyTimelineProps {
  expenses: TimelineExpense[];
}

export function PaymentStrategyTimeline({
  expenses,
}: PaymentStrategyTimelineProps) {
  const timelineData = useMemo(() => {
    // Filter expenses with strategy data
    const strategyExpenses = expenses.filter(
      (e) =>
        e.reimbursement_strategy && e.reimbursement_strategy !== "immediate",
    );

    // Sort by date
    return strategyExpenses.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [expenses]);

  const monthlyFlows = useMemo(() => {
    const flows: Map<string, { outflows: number; inflows: number }> = new Map();

    timelineData.forEach((expense) => {
      // Calculate payoff period
      const expenseDate = new Date(expense.date);
      for (let i = 0; i < expense.card_payoff_months; i++) {
        const monthKey = new Date(
          expenseDate.getFullYear(),
          expenseDate.getMonth() + i,
          1,
        )
          .toISOString()
          .slice(0, 7);
        const current = flows.get(monthKey) || { outflows: 0, inflows: 0 };
        current.outflows += expense.amount / expense.card_payoff_months;
        flows.set(monthKey, current);
      }

      // Add inflow at reimbursement date
      if (expense.planned_reimbursement_date) {
        const reimburseMonth = expense.planned_reimbursement_date.slice(0, 7);
        const current = flows.get(reimburseMonth) || {
          outflows: 0,
          inflows: 0,
        };
        current.inflows += expense.amount;
        flows.set(reimburseMonth, current);
      }
    });

    return Array.from(flows.entries())
      .map(([month, flow]) => ({
        month,
        ...flow,
        net: flow.inflows - flow.outflows,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(0, 12); // Show next 12 months
  }, [timelineData]);

  if (timelineData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payment Strategy Timeline</CardTitle>
          <CardDescription>
            No expenses with payment strategies yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Ready to track your first expense? Add an expense to see your
            timeline and strategy recommendations.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Payment Strategy Timeline
          </CardTitle>
          <CardDescription>
            Visualize your payment strategies and cash flows
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Strategy Expenses */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Active Strategy Expenses</h3>
            {timelineData.map((expense) => {
              const expenseDate = new Date(expense.date);
              const payoffEndDate = new Date(expenseDate);
              payoffEndDate.setMonth(
                payoffEndDate.getMonth() + expense.card_payoff_months,
              );

              return (
                <div
                  key={expense.id}
                  className="relative pl-6 border-l-2 border-primary/30"
                >
                  <div className="absolute -left-2 top-0 h-4 w-4 rounded-full bg-primary" />
                  <div className="pb-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{expense.vendor}</span>
                        <Badge variant="outline">
                          {expense.reimbursement_strategy === "vault"
                            ? "💎 Vault"
                            : "Medium-term"}
                        </Badge>
                      </div>
                      <Money value={expense.amount} className="font-semibold" />
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div className="flex items-center gap-4">
                        <span>
                          📅 Expense: {expenseDate.toLocaleDateString()}
                        </span>
                        {expense.card_payoff_months > 0 && (
                          <span>
                            💳 Payoff: {expense.card_payoff_months} months
                          </span>
                        )}
                      </div>
                      {expense.planned_reimbursement_date && (
                        <div>
                          <span>
                            💰 Reimburse:{" "}
                            {new Date(
                              expense.planned_reimbursement_date,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Monthly Cash Flow Summary */}
          <div className="space-y-3 pt-4 border-t">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Monthly Cash Flow (Next 12 Months)
            </h3>
            <div className="space-y-2">
              {monthlyFlows.map((flow) => (
                <div key={flow.month} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-20">
                    {new Date(flow.month + "-01").toLocaleDateString("en-US", {
                      month: "short",
                      year: "2-digit",
                    })}
                  </span>
                  <div className="flex-1 flex gap-2 items-center">
                    {flow.outflows > 0 && (
                      <div
                        className="bg-red-500/20 h-6 rounded flex items-center justify-center text-xs px-2"
                        style={{
                          width: `${(flow.outflows / Math.max(...monthlyFlows.map((f) => Math.max(f.outflows, f.inflows)))) * 100}%`,
                        }}
                      >
                        -{flow.outflows.toFixed(0)}
                      </div>
                    )}
                    {flow.inflows > 0 && (
                      <div
                        className="bg-green-500/20 h-6 rounded flex items-center justify-center text-xs px-2"
                        style={{
                          width: `${(flow.inflows / Math.max(...monthlyFlows.map((f) => Math.max(f.outflows, f.inflows)))) * 100}%`,
                        }}
                      >
                        +{flow.inflows.toFixed(0)}
                      </div>
                    )}
                  </div>
                  <Money
                    value={flow.net}
                    whole
                    className={`text-sm font-medium w-20 text-right ${flow.net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground pt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500/20 rounded" />
                <span>Card payments</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500/20 rounded" />
                <span>HSA reimbursements</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
