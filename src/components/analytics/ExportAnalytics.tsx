import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import { generateAnalyticsReportPDF } from "@/lib/pdfGenerator";

interface ExportData {
  stats: {
    totalExpenses: number;
    hsaEligible: number;
    projectedSavings: number;
    actualSavings: number;
    avgMonthly: number;
    unreimbursedHsaTotal: number;
  };
  monthlyData: any[];
  categoryData: any[];
  paymentMethodsRewards: any[];
  yearlyData: any[];
}

interface ExportAnalyticsProps {
  data: ExportData;
  dateRange?: string;
}

export const ExportAnalytics = ({
  data,
  dateRange = "All Time",
}: ExportAnalyticsProps) => {
  const [exporting, setExporting] = useState(false);

  const exportToCSV = () => {
    setExporting(true);
    try {
      // Summary Stats
      const statsCSV = [
        ["Metric", "Value"],
        ["Total Expenses", `$${data.stats.totalExpenses.toFixed(2)}`],
        ["HSA Eligible", `$${data.stats.hsaEligible.toFixed(2)}`],
        ["Projected Savings", `$${data.stats.projectedSavings.toFixed(2)}`],
        ["Actual Savings", `$${data.stats.actualSavings.toFixed(2)}`],
        ["Average Monthly", `$${data.stats.avgMonthly.toFixed(2)}`],
        [
          "Unreimbursed HSA Total",
          `$${data.stats.unreimbursedHsaTotal.toFixed(2)}`,
        ],
      ];

      // Monthly Data
      const monthlyCSV = [
        ["", ""],
        ["MONTHLY TRENDS"],
        ["Month", "Total"],
        ...data.monthlyData.map((m) => [m.month, m.total]),
      ];

      // Category Data
      const categoryCSV = [
        ["", ""],
        ["CATEGORY BREAKDOWN"],
        ["Category", "Total"],
        ...data.categoryData.map((c) => [c.category, c.total]),
      ];

      // Rewards Data
      const rewardsCSV = [
        ["", ""],
        ["REWARDS BY PAYMENT METHOD"],
        ["Payment Method", "Rewards Earned", "Rewards Rate", "Total Spent"],
        ...data.paymentMethodsRewards.map((pm) => [
          pm.name,
          pm.rewardsEarned.toFixed(2),
          `${pm.rewardsRate}%`,
          pm.totalSpent.toFixed(2),
        ]),
      ];

      // Yearly Data
      const yearlyCSV = [
        ["", ""],
        ["YEAR-OVER-YEAR COMPARISON"],
        [
          "Year",
          "Total Expenses",
          "Tax Savings",
          "Rewards Earned",
          "HSA Eligible",
        ],
        ...data.yearlyData.map((y) => [
          y.year,
          y.totalExpenses.toFixed(2),
          y.taxSavings.toFixed(2),
          y.rewardsEarned.toFixed(2),
          y.hsaEligible.toFixed(2),
        ]),
      ];

      const csvContent = [
        [`"Analytics Report - ${dateRange}"`],
        [`"Generated on ${new Date().toLocaleString()}"`],
        [""],
        ["SUMMARY STATISTICS"],
        ...statsCSV,
        ...monthlyCSV,
        ...categoryCSV,
        ...rewardsCSV,
        ...yearlyCSV,
      ]
        .map((row) => row.join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `analytics-report-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();

      toast.success("CSV exported successfully");
    } catch (error) {
      logError("Export error", error);
      toast.error("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const exportToJSON = () => {
    setExporting(true);
    try {
      const jsonData = {
        report: "Analytics Report",
        dateRange,
        generatedAt: new Date().toISOString(),
        summary: data.stats,
        monthlyTrends: data.monthlyData,
        categoryBreakdown: data.categoryData,
        rewardsOptimization: data.paymentMethodsRewards,
        yearOverYear: data.yearlyData,
      };

      const blob = new Blob([JSON.stringify(jsonData, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `analytics-report-${new Date().toISOString().split("T")[0]}.json`;
      link.click();

      toast.success("JSON exported successfully");
    } catch (error) {
      logError("Export error", error);
      toast.error("Failed to export JSON");
    } finally {
      setExporting(false);
    }
  };

  const exportToPDF = () => {
    setExporting(true);
    try {
      generateAnalyticsReportPDF({
        dateRange,
        stats: data.stats,
        monthlyData: data.monthlyData,
        categoryData: data.categoryData,
        paymentMethodsRewards: data.paymentMethodsRewards,
        yearlyData: data.yearlyData,
      });
      toast.success("PDF exported successfully");
    } catch (error) {
      logError("PDF export error", error);
      toast.error("Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={exporting}>
          <Download className="h-4 w-4 mr-2" />
          {exporting ? "Exporting..." : "Export Report"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportToCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToJSON}>
          <FileText className="h-4 w-4 mr-2" />
          Export as JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToPDF}>
          <FileText className="h-4 w-4 mr-2" />
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
