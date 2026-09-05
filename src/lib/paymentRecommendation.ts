// Payment Strategy Recommendation Engine
// Helps users make optimal payment decisions for HSA-eligible expenses

import { formatCurrency } from "@/lib/utils";

export interface PaymentRecommendation {
  method: "hsa" | "rewards-card" | "hsa-invest";
  title: string;
  description: string;
  savingsAmount: number;
  confidence: "high" | "medium" | "low";
  reasoning: string[];
  taxSavings?: number;
  breakdown: {
    rewards: number;
    taxSavings: number;
    timingBenefit: number;
    investmentGrowth: number;
  };
}

interface RecommendationInput {
  amount: number;
  category: string;
  isHsaEligible: boolean;
  hasHsaCard?: boolean;
  hasRewardsCard?: boolean;
  rewardsRate?: number; // e.g., 0.02 for 2%
  currentHsaBalance?: number;
  taxRate?: number; // e.g., 0.22 for 22%
  investmentReturnRate?: number; // e.g., 0.07 for 7%
  cardPayoffMonths?: number; // e.g., 12 months for 0% APR period
  monthlyPayment?: number; // Optional: if user knows minimum payment
  hsaInvestmentYears?: number; // e.g., 5 years until reimbursement
}

// Calculate investment growth with declining principal (if monthly payments exist)
export const calculateInvestmentGrowth = (
  principal: number,
  monthlyRate: number,
  months: number,
  monthlyPayment: number,
): number => {
  if (monthlyPayment <= 0) {
    // No monthly payments - simple compound growth on full principal
    return principal * Math.pow(1 + monthlyRate, months) - principal;
  }

  // With monthly payments, calculate growth on declining balance
  let balance = principal;
  let totalGrowth = 0;

  for (let month = 0; month < months; month++) {
    const growth = balance * monthlyRate;
    totalGrowth += growth;
    balance = balance + growth - monthlyPayment;
    if (balance <= 0) break;
  }

  return totalGrowth;
};

export const getPaymentRecommendation = (
  input: RecommendationInput,
): PaymentRecommendation => {
  const {
    amount,
    isHsaEligible,
    hasRewardsCard: _hasRewardsCard = true,
    rewardsRate = 0.02, // Default 2%
    taxRate = 0.22, // Default 22% marginal tax rate
    investmentReturnRate = 0.07, // Default 7% annual return
    cardPayoffMonths = 12, // Default 12 months
    monthlyPayment = 0, // Default: no minimum payments (pay in full at end)
    hsaInvestmentYears = 5, // Default 5 years until reimbursement
  } = input;

  if (!isHsaEligible) {
    // Not HSA eligible - use rewards card
    const savingsAmount = amount * rewardsRate;
    return {
      method: "rewards-card",
      title: "Use Your Rewards Card",
      description: `This expense isn't HSA-eligible. Here's what you'd earn from card rewards.`,
      savingsAmount,
      confidence: "high",
      reasoning: [
        "This expense is not eligible for HSA reimbursement",
        `A ${(rewardsRate * 100).toFixed(1)}% rewards card earns ${formatCurrency(savingsAmount)} back on this expense`,
      ],
      breakdown: {
        rewards: savingsAmount,
        taxSavings: 0,
        timingBenefit: 0,
        investmentGrowth: 0,
      },
    };
  }

  // HSA-eligible expense - calculate the "invest and reimburse later" strategy
  const rewardsValue = amount * rewardsRate;
  const taxSavings = amount * taxRate;

  // Timing benefit: Investment growth during card payoff period (on declining balance if monthly payments)
  const monthlyInvestmentRate = investmentReturnRate / 12;
  const timingBenefit = calculateInvestmentGrowth(
    amount,
    monthlyInvestmentRate,
    cardPayoffMonths,
    monthlyPayment,
  );

  // Long-term investment growth: From card payoff to eventual reimbursement
  const remainingBalance =
    monthlyPayment > 0
      ? Math.max(0, amount - monthlyPayment * cardPayoffMonths)
      : amount;

  const yearsAfterPayoff = hsaInvestmentYears - cardPayoffMonths / 12;
  const longTermGrowth =
    yearsAfterPayoff > 0
      ? remainingBalance *
          Math.pow(1 + investmentReturnRate, yearsAfterPayoff) -
        remainingBalance
      : 0;

  const totalInvestmentGrowth = timingBenefit + longTermGrowth;

  // Total benefit includes rewards, tax savings, and all investment growth
  const totalBenefit = rewardsValue + taxSavings + totalInvestmentGrowth;

  const reasoning = [
    `💳 Credit card rewards: +${formatCurrency(rewardsValue)} (earned immediately)`,
    `🏥 HSA tax savings: +${formatCurrency(taxSavings)} (${(taxRate * 100).toFixed(0)}% of expense)`,
  ];

  if (timingBenefit > 0) {
    reasoning.push(
      `📈 Growth during payoff: +${formatCurrency(timingBenefit)} (${cardPayoffMonths} months${monthlyPayment > 0 ? " with declining balance" : ""})`,
    );
  }

  if (longTermGrowth > 0) {
    reasoning.push(
      `📊 Long-term growth: +${formatCurrency(longTermGrowth)} (${yearsAfterPayoff.toFixed(1)} years after payoff)`,
    );
  }

  reasoning.push(
    "⏰ Card must be paid off on time to avoid interest charges",
    "📄 Receipts are required for HSA reimbursement — there's no deadline to submit",
  );

  const payoffDescription =
    cardPayoffMonths <= 1 ? "immediately" : `over ${cardPayoffMonths} months`;

  return {
    method: "hsa-invest",
    title: "Rewards Card + Delayed HSA Reimbursement",
    description: `Paying with a rewards card ${payoffDescription} and reimbursing from your HSA in ${hsaInvestmentYears} years could save you ${formatCurrency(totalBenefit)}.`,
    savingsAmount: totalBenefit,
    taxSavings,
    confidence: "high",
    reasoning,
    breakdown: {
      rewards: rewardsValue,
      taxSavings,
      timingBenefit,
      investmentGrowth: longTermGrowth,
    },
  };
};

// Quick tip generator for expense entry
export const getQuickTip = (isHsaEligible: boolean): string => {
  if (isHsaEligible) {
    return "💡 Pro Tip: Pay with a rewards card and save your receipt. Let your HSA funds grow invested, then reimburse yourself later for double benefits!";
  }
  return "💳 Use your best rewards card for this expense.";
};
