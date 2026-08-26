import { calculateInvestmentGrowth } from "./paymentRecommendation";

// Helper to calculate investment growth with year-based inputs
function calculateYearlyInvestmentGrowth(
  principal: number,
  years: number,
  annualReturn: number,
  monthlyPayment: number,
  _payoffMonths: number,
): number {
  if (years <= 0) return 0;

  const monthlyRate = annualReturn / 12;
  const months = Math.round(years * 12);

  return calculateInvestmentGrowth(
    principal,
    monthlyRate,
    months,
    monthlyPayment,
  );
}

export interface VaultExpense {
  id: string;
  date: string;
  vendor: string;
  amount: number;
  category: string;
  reimbursement_strategy: "immediate" | "medium" | "vault";
  planned_reimbursement_date: string | null;
  card_payoff_months: number;
  investment_notes: string | null;
}

export interface VaultSummary {
  totalInVault: number;
  expenseCount: number;
  projectedGrowth: number;
  nextReminder: string | null;
  averageYearsInvested: number;
}

export function calculateVaultSummary(
  expenses: VaultExpense[],
  investmentReturn: number = 0.08,
): VaultSummary {
  const vaultExpenses = expenses.filter(
    (e) => e.reimbursement_strategy === "vault",
  );
  const totalInVault = vaultExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Calculate projected growth for each expense based on time until reimbursement
  const projectedGrowth = vaultExpenses.reduce((sum, expense) => {
    if (!expense.planned_reimbursement_date) return sum;

    const monthsUntilReimbursement = Math.max(
      0,
      (new Date(expense.planned_reimbursement_date).getTime() -
        new Date().getTime()) /
        (1000 * 60 * 60 * 24 * 30),
    );

    const yearsInvested = monthsUntilReimbursement / 12;
    const growth = calculateYearlyInvestmentGrowth(
      expense.amount,
      yearsInvested,
      investmentReturn,
      0,
      0,
    );

    return sum + growth;
  }, 0);

  // Find next reminder date
  const upcomingReminders = expenses
    .filter((e) => e.planned_reimbursement_date)
    .map((e) => new Date(e.planned_reimbursement_date!))
    .filter((date) => date > new Date())
    .sort((a, b) => a.getTime() - b.getTime());

  const nextReminder =
    upcomingReminders.length > 0
      ? upcomingReminders[0].toISOString().split("T")[0]
      : null;

  // Calculate average years invested
  const totalYears = vaultExpenses.reduce((sum, expense) => {
    if (!expense.planned_reimbursement_date) return sum;
    const monthsInvested =
      (new Date(expense.planned_reimbursement_date).getTime() -
        new Date(expense.date).getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    return sum + monthsInvested / 12;
  }, 0);

  const averageYearsInvested =
    vaultExpenses.length > 0 ? totalYears / vaultExpenses.length : 0;

  return {
    totalInVault,
    expenseCount: vaultExpenses.length,
    projectedGrowth,
    nextReminder,
    averageYearsInvested,
  };
}

export function calculateExpenseProjectedValue(
  expense: VaultExpense,
  investmentReturn: number = 0.08,
): number {
  if (!expense.planned_reimbursement_date) return expense.amount;

  const monthsUntilReimbursement = Math.max(
    0,
    (new Date(expense.planned_reimbursement_date).getTime() -
      new Date().getTime()) /
      (1000 * 60 * 60 * 24 * 30),
  );

  const yearsInvested = monthsUntilReimbursement / 12;
  const growth = calculateYearlyInvestmentGrowth(
    expense.amount,
    yearsInvested,
    investmentReturn,
    0,
    0,
  );

  return expense.amount + growth;
}

export function getReimbursementStrategyLabel(strategy: string): string {
  switch (strategy) {
    case "immediate":
      return "Immediate (< 1 year)";
    case "medium":
      return "Medium-term (1-3 years)";
    case "vault":
      return "Long-term Vault (3+ years)";
    default:
      return "Unknown";
  }
}

export function getDefaultReimbursementDate(
  strategy: "immediate" | "medium" | "vault",
  expenseDate: string,
): string {
  const date = new Date(expenseDate);
  switch (strategy) {
    case "immediate":
      date.setMonth(date.getMonth() + 6); // 6 months
      break;
    case "medium":
      date.setFullYear(date.getFullYear() + 2); // 2 years
      break;
    case "vault":
      date.setFullYear(date.getFullYear() + 5); // 5 years
      break;
  }
  return date.toISOString().split("T")[0];
}
