import {
  LucideIcon,
  ListChecks,
  FileText,
  DollarSign,
  TrendingUp,
} from "lucide-react";

export interface DashboardAction {
  priority: number;
  title: string;
  description: string;
  buttonText: string;
  route: string;
  icon: LucideIcon;
  timeEstimate?: string;
}

export interface DashboardStats {
  unreviewedTransactions: number;
  expenseCount: number;
  hsaClaimableAmount: number;
  hasConnectedBank: boolean;
}

export function getNextAction(stats: DashboardStats): DashboardAction {
  // Priority 1: Unreviewed transactions
  if (stats.unreviewedTransactions > 0) {
    return {
      priority: 1,
      title: "Review Your Transactions",
      description: `You have ${stats.unreviewedTransactions} ${stats.unreviewedTransactions === 1 ? "transaction" : "transactions"} waiting for review`,
      buttonText: `Review ${stats.unreviewedTransactions} Transaction${stats.unreviewedTransactions === 1 ? "" : "s"}`,
      route: "/transactions?tab=review",
      icon: ListChecks,
      timeEstimate:
        stats.unreviewedTransactions <= 5 ? "~2 minutes" : "~5 minutes",
    };
  }

  // Priority 2: No expenses yet
  if (stats.expenseCount === 0) {
    return {
      priority: 2,
      title: "Add Your First Medical Bill",
      description:
        "Start tracking your healthcare expenses to maximize savings",
      buttonText: "Add Your First Bill",
      route: "/expenses/new",
      icon: FileText,
      timeEstimate: "~1 minute",
    };
  }

  // Priority 3: HSA money to claim
  if (stats.hsaClaimableAmount > 0) {
    return {
      priority: 3,
      title: "Claim Money from Your HSA",
      description: `You have $${stats.hsaClaimableAmount.toFixed(2)} ready to reimburse`,
      buttonText: `Claim $${stats.hsaClaimableAmount.toFixed(2)}`,
      route: "/substantiation",
      icon: DollarSign,
      timeEstimate: "~3 minutes",
    };
  }

  // Priority 4: Everything done.
  //
  // Pointed at /reports until 2026-08-20. That page is gone, and the nearest
  // equivalent -- the claim list -- is already where priority 3 sends people,
  // so this sends them to the expense list instead: with nothing outstanding,
  // the useful thing to see is the record itself.
  return {
    priority: 4,
    title: "You're All Caught Up!",
    description: "Great work! Review what you've tracked or add new expenses",
    buttonText: "View Your Expenses",
    route: "/expenses",
    icon: TrendingUp,
    timeEstimate: undefined,
  };
}
