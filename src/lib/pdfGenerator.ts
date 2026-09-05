import jsPDF from "jspdf";

// Workstream E1: generateReimbursementPDF lived here and was deleted with the
// legacy reimbursement path. The canonical document is the Substantiation
// Record in src/lib/substantiationRecord.ts, which snapshots every expense at
// submission and carries the Pub 502 basis and confirmation timestamp this one
// never did.

// Exported so ExportAnalytics can derive its own props from it. That component
// hands its data straight to generateAnalyticsReportPDF, and its four arrays
// were typed `any[]`, so a shape mismatch between the two would not have been
// caught by the compiler.
export interface AnalyticsReport {
  dateRange: string;
  stats: {
    totalExpenses: number;
    hsaEligible: number;
    projectedSavings: number;
    actualSavings: number;
    avgMonthly: number;
    unreimbursedHsaTotal: number;
  };
  monthlyData: { month: string; total: number }[];
  categoryData: { category: string; total: number }[];
  paymentMethodsRewards: {
    name: string;
    rewardsEarned: number;
    rewardsRate: number;
    totalSpent: number;
  }[];
  yearlyData: {
    year: number;
    totalExpenses: number;
    taxSavings: number;
    rewardsEarned: number;
    hsaEligible: number;
  }[];
}

export const generateAnalyticsReportPDF = (data: AnalyticsReport): void => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 20;

  const addRow = (label: string, value: string, indent = 20) => {
    if (y > pageHeight - 20) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.text(label, indent, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 130, y);
    y += 7;
  };

  const addSectionHeader = (title: string) => {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 20;
    }
    y += 5;
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(title, 20, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
  };

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Analytics Report", pageWidth / 2, y, { align: "center" });
  y += 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Period: ${data.dateRange}`, pageWidth / 2, y, { align: "center" });
  y += 5;
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, {
    align: "center",
  });
  y += 15;

  // Summary
  addSectionHeader("Summary Statistics");
  addRow("Total Expenses", `$${data.stats.totalExpenses.toFixed(2)}`);
  addRow("HSA Eligible", `$${data.stats.hsaEligible.toFixed(2)}`);
  addRow("Projected Tax Savings", `$${data.stats.projectedSavings.toFixed(2)}`);
  addRow("Actual Tax Savings", `$${data.stats.actualSavings.toFixed(2)}`);
  addRow("Average Monthly", `$${data.stats.avgMonthly.toFixed(2)}`);
  addRow(
    "Unreimbursed HSA Total",
    `$${data.stats.unreimbursedHsaTotal.toFixed(2)}`,
  );

  // Monthly trends
  if (data.monthlyData.length > 0) {
    addSectionHeader("Monthly Trends");
    data.monthlyData.forEach((m) =>
      addRow(m.month, `$${Number(m.total).toFixed(2)}`),
    );
  }

  // Category breakdown
  if (data.categoryData.length > 0) {
    addSectionHeader("Category Breakdown");
    data.categoryData.forEach((c) =>
      addRow(c.category, `$${Number(c.total).toFixed(2)}`),
    );
  }

  // Rewards
  if (data.paymentMethodsRewards.length > 0) {
    addSectionHeader("Rewards by Payment Method");
    data.paymentMethodsRewards.forEach((pm) => {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(pm.name, 20, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.text(
        `Rewards earned: $${Number(pm.rewardsEarned).toFixed(2)} | Rate: ${pm.rewardsRate}% | Spent: $${Number(pm.totalSpent).toFixed(2)}`,
        25,
        y,
      );
      y += 7;
    });
  }

  // Year-over-year
  if (data.yearlyData.length > 0) {
    addSectionHeader("Year-over-Year Comparison");
    data.yearlyData.forEach((yr) => {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(String(yr.year), 20, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.text(
        `Expenses: $${yr.totalExpenses.toFixed(2)} | Tax Savings: $${yr.taxSavings.toFixed(2)} | Rewards: $${yr.rewardsEarned.toFixed(2)} | HSA Eligible: $${yr.hsaEligible.toFixed(2)}`,
        25,
        y,
      );
      y += 7;
    });
  }

  doc.save(`analytics-report-${new Date().toISOString().split("T")[0]}.pdf`);
};
