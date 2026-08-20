// HSA Reimbursement and Payment Strategy Calculations

import type { Database } from "@/integrations/supabase/types";

export interface PaymentTransaction {
  id: string;
  amount: number;
  payment_source: "hsa_direct" | "out_of_pocket" | "unpaid";
  payment_date: string;
  payment_method_id?: string;
}

// Nullability here mirrors the `invoices` row type. total_amount is nullable
// in the DB and falls back to `amount` below. eligibility_state replaces the
// old is_hsa_eligible boolean, which was a derived column meaning exactly
// `eligibility_state = 'eligible'`; anything else ('unknown', 'conditional',
// 'ineligible', or null before it is decided) reads as "not established as
// eligible" for these sums, which is how the boolean behaved.
export interface ExpenseReport {
  id: string;
  total_amount?: number | null;
  amount: number;
  eligibility_state:
    Database["public"]["Enums"]["expense_eligibility_state"] | null;
  vendor: string;
  category: string;
  date: string;
}

export interface HSAEligibilityBreakdown {
  totalInvoiced: number;
  paidViaHSA: number;
  paidViaOther: number;
  unpaidBalance: number;
  hsaReimbursementEligible: number;
  alreadyPaidRecoverable: number;
  unpaidStrategicOpportunity: number;
  potentialRewards: number;
}

export const calculateHSAEligibility = (
  expenseReport: ExpenseReport,
  payments: PaymentTransaction[],
): HSAEligibilityBreakdown => {
  const totalInvoiced = Number(
    expenseReport.total_amount || expenseReport.amount,
  );

  const paidViaHSA = payments
    .filter((p) => p.payment_source === "hsa_direct")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const paidViaOther = payments
    .filter((p) => p.payment_source === "out_of_pocket")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const unpaidBalance = totalInvoiced - paidViaHSA - paidViaOther;

  const isEligible = expenseReport.eligibility_state === "eligible";

  // HSA Reimbursement Eligible = Out-of-pocket payments + Unpaid balance
  // (Assumes the expense is HSA eligible)
  const hsaReimbursementEligible = isEligible
    ? paidViaOther + unpaidBalance
    : 0;

  const alreadyPaidRecoverable = isEligible ? paidViaOther : 0;
  const unpaidStrategicOpportunity = isEligible ? unpaidBalance : 0;

  // Assume 2% average credit card rewards on out-of-pocket payments
  const potentialRewards = unpaidBalance * 0.02;

  return {
    totalInvoiced,
    paidViaHSA,
    paidViaOther,
    unpaidBalance,
    hsaReimbursementEligible,
    alreadyPaidRecoverable,
    unpaidStrategicOpportunity,
    potentialRewards,
  };
};

export const calculateAggregateHSAStats = (
  expenseReports: (ExpenseReport & { payments?: PaymentTransaction[] })[],
) => {
  let totalInvoiced = 0;
  let totalPaidViaHSA = 0;
  let totalPaidViaOther = 0;
  let totalUnpaid = 0;
  let totalHSAEligible = 0;
  let totalRecoverable = 0;
  let totalStrategicOpportunity = 0;
  let totalPotentialRewards = 0;

  expenseReports.forEach((report) => {
    const payments = report.payments || [];
    const breakdown = calculateHSAEligibility(report, payments);

    totalInvoiced += breakdown.totalInvoiced;
    totalPaidViaHSA += breakdown.paidViaHSA;
    totalPaidViaOther += breakdown.paidViaOther;
    totalUnpaid += breakdown.unpaidBalance;
    totalHSAEligible += breakdown.hsaReimbursementEligible;
    totalRecoverable += breakdown.alreadyPaidRecoverable;
    totalStrategicOpportunity += breakdown.unpaidStrategicOpportunity;
    totalPotentialRewards += breakdown.potentialRewards;
  });

  // Investment growth calculation: assume 7% annual return over 30 years for money kept in HSA
  const taxSavings = totalHSAEligible * 0.3; // 30% tax bracket savings
  const investmentGrowthPotential = totalHSAEligible * Math.pow(1.07, 30); // 7% compounded over 30 years

  return {
    totalInvoiced,
    totalPaidViaHSA,
    totalPaidViaOther,
    totalUnpaid,
    totalHSAEligible,
    totalRecoverable,
    totalStrategicOpportunity,
    totalPotentialRewards,
    taxSavings,
    investmentGrowthPotential,
  };
};

export const getPaymentStatusBadge = (
  totalAmount: number,
  paidViaHSA: number,
  paidViaOther: number,
): { status: string; variant: string; color: string } => {
  const totalPaid = paidViaHSA + paidViaOther;
  const unpaid = totalAmount - totalPaid;

  if (unpaid <= 0) {
    return {
      status: "Fully Paid",
      variant: "default",
      color:
        "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    };
  } else if (totalPaid > 0) {
    return {
      status: `Partially Paid (${((totalPaid / totalAmount) * 100).toFixed(0)}%)`,
      variant: "secondary",
      color:
        "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    };
  } else {
    return {
      status: "Unpaid",
      variant: "destructive",
      color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    };
  }
};
