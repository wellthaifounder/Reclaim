import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { analytics } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, TrendingUp, DollarSign, PieChart } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart as RechartsPie,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { HSAInvestmentTracker } from "@/components/analytics/HSAInvestmentTracker";
import { ReimbursementTimingOptimizer } from "@/components/analytics/ReimbursementTimingOptimizer";
import { RewardsOptimizationDashboard } from "@/components/analytics/RewardsOptimizationDashboard";
import { YearOverYearComparison } from "@/components/analytics/YearOverYearComparison";
import { PaymentStrategyTimeline } from "@/components/analytics/PaymentStrategyTimeline";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { logError } from "@/utils/errorHandler";
import { AnalyticsEmptyState } from "@/components/analytics/AnalyticsEmptyState";
import {
  AnalyticsSettings,
  AnalyticsAssumptions,
} from "@/components/analytics/AnalyticsSettings";
import {
  TimeRangeFilter,
  TimeRange,
} from "@/components/analytics/TimeRangeFilter";
import { HSAAccountFilter } from "@/components/analytics/HSAAccountFilter";
import { GoalSetting } from "@/components/analytics/GoalSetting";
import { ExportAnalytics } from "@/components/analytics/ExportAnalytics";
import { TaxPackageExport } from "@/components/analytics/TaxPackageExport";
import { Benchmarking } from "@/components/analytics/Benchmarking";
import { AIInsights } from "@/components/analytics/AIInsights";
import { AnalyticsSkeleton } from "@/components/skeletons/AnalyticsSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DateRange } from "react-day-picker";
import { startOfYear, subMonths } from "date-fns";

const Reports = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalExpenses: 0,
    hsaEligible: 0,
    projectedSavings: 0,
    actualSavings: 0,
    avgMonthly: 0,
    unreimbursedHsaTotal: 0,
  });
  const [paymentMethodsRewards, setPaymentMethodsRewards] = useState<any[]>([]);
  const [yearlyData, setYearlyData] = useState<any[]>([]);
  const [hasData, setHasData] = useState(false);

  // Time range filtering
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [customDateRange, setCustomDateRange] = useState<
    DateRange | undefined
  >();

  // HSA Account filtering
  const [selectedHSAAccount, setSelectedHSAAccount] = useState<string>("all");

  // Customizable assumptions
  const [assumptions, setAssumptions] = useState<AnalyticsAssumptions>(() => {
    const saved = localStorage.getItem("analyticsAssumptions");
    return saved
      ? JSON.parse(saved)
      : {
          investmentReturnRate: 7,
          currentTaxBracket: 22,
          projectedTaxBracket: 24,
          defaultRewardsRate: 2,
        };
  });

  const handleAssumptionsUpdate = (newAssumptions: AnalyticsAssumptions) => {
    setAssumptions(newAssumptions);
    localStorage.setItem(
      "analyticsAssumptions",
      JSON.stringify(newAssumptions),
    );
  };

  const COLORS = [
    "hsl(186 100% 40%)",
    "hsl(27 96% 61%)",
    "hsl(214 95% 50%)",
    "hsl(120 60% 50%)",
    "hsl(0 84% 60%)",
  ];

  useEffect(() => {
    fetchAnalytics();
    analytics.pageView("/reports");
  }, [timeRange, customDateRange, selectedHSAAccount]);

  const getDateRangeFilter = () => {
    const now = new Date();
    switch (timeRange) {
      case "ytd":
        return startOfYear(now);
      case "last12":
        return subMonths(now, 12);
      case "custom":
        return customDateRange?.from || null;
      default:
        return null;
    }
  };

  const fetchAnalytics = async () => {
    try {
      let query = supabase
        .from("invoices")
        .select(
          "date, amount, category, is_hsa_eligible, is_reimbursed, payment_method_id",
        )
        .order("date", { ascending: true })
        .limit(1000); // Prevent loading excessive data for performance

      const startDate = getDateRangeFilter();
      if (startDate) {
        query = query.gte("date", startDate.toISOString().split("T")[0]);
      }

      if (timeRange === "custom" && customDateRange?.to) {
        query = query.lte(
          "date",
          customDateRange.to.toISOString().split("T")[0],
        );
      }

      // Filter by HSA account if selected
      if (selectedHSAAccount !== "all") {
        query = query.eq("hsa_account_id", selectedHSAAccount);
      }

      const { data: invoices, error } = await query;

      const { data: paymentMethods } = await supabase
        .from("payment_methods")
        .select("id, name, rewards_rate");

      if (error) throw error;

      // Check if we have any data
      setHasData((invoices?.length || 0) > 0);

      // Calculate monthly trends
      const monthlyTotals: Record<string, number> = {};
      const categoryTotals: Record<string, number> = {};
      let hsaTotal = 0;
      let unreimbursedHsaTotal = 0;
      let reimbursedHsaTotal = 0;

      invoices?.forEach((inv) => {
        const month = new Date(inv.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
        });
        monthlyTotals[month] = (monthlyTotals[month] || 0) + Number(inv.amount);
        categoryTotals[inv.category] =
          (categoryTotals[inv.category] || 0) + Number(inv.amount);
        if (inv.is_hsa_eligible) {
          hsaTotal += Number(inv.amount);
          if (inv.is_reimbursed) {
            reimbursedHsaTotal += Number(inv.amount);
          } else {
            unreimbursedHsaTotal += Number(inv.amount);
          }
        }
      });

      const monthlyChartData = Object.entries(monthlyTotals).map(
        ([month, total]) => ({
          month,
          total: Number(total.toFixed(2)),
        }),
      );

      const categoryChartData = Object.entries(categoryTotals)
        .map(([category, total]) => ({
          category,
          total: Number(total.toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total);

      const totalExpenses =
        invoices?.reduce((sum, inv) => sum + Number(inv.amount), 0) || 0;
      const avgMonthly =
        monthlyChartData.length > 0
          ? totalExpenses / monthlyChartData.length
          : 0;

      setMonthlyData(monthlyChartData);
      setCategoryData(categoryChartData);
      setStats({
        totalExpenses,
        hsaEligible: hsaTotal,
        projectedSavings: unreimbursedHsaTotal * 0.3,
        actualSavings: reimbursedHsaTotal * 0.3,
        avgMonthly,
        unreimbursedHsaTotal,
      });

      // Calculate rewards by payment method
      if (paymentMethods && invoices) {
        const rewardsByMethod = paymentMethods.map((pm) => {
          const pmInvoices = invoices.filter(
            (inv) => inv.payment_method_id === pm.id,
          );
          const totalSpent = pmInvoices.reduce(
            (sum, inv) => sum + Number(inv.amount),
            0,
          );
          const rewardsRate =
            Number(pm.rewards_rate) || assumptions.defaultRewardsRate;
          const rewardsEarned = totalSpent * (rewardsRate / 100);

          return {
            name: pm.name,
            rewardsEarned,
            rewardsRate,
            totalSpent,
          };
        });
        setPaymentMethodsRewards(rewardsByMethod);
      }

      // Calculate yearly data
      if (invoices) {
        const yearlyStats = invoices.reduce((acc: any, inv) => {
          const year = new Date(inv.date).getFullYear();
          if (!acc[year]) {
            acc[year] = {
              year,
              totalExpenses: 0,
              taxSavings: 0,
              rewardsEarned: 0,
              hsaEligible: 0,
            };
          }

          const amount = Number(inv.amount);
          acc[year].totalExpenses += amount;
          acc[year].rewardsEarned +=
            amount * (assumptions.defaultRewardsRate / 100);

          if (inv.is_hsa_eligible) {
            acc[year].hsaEligible += amount;
            acc[year].taxSavings +=
              amount * (assumptions.currentTaxBracket / 100);
          }

          return acc;
        }, {});

        setYearlyData(
          Object.values(yearlyStats).sort((a: any, b: any) => a.year - b.year),
        );
      }
    } catch (error) {
      logError("Failed to fetch analytics", error);
      toast.error("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <AnalyticsSkeleton />
      </AuthenticatedLayout>
    );
  }

  return (
    <ErrorBoundary
      fallbackTitle="Analytics Error"
      fallbackDescription="We encountered an error loading your analytics. Your data is safe. Please try again."
      onReset={() => {
        setLoading(true);
        fetchAnalytics();
      }}
    >
      <AuthenticatedLayout>
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="mb-6">
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>

          <div className="mb-8">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
              <div>
                <h1 className="text-3xl font-bold mb-2">Reports</h1>
                <p className="text-muted-foreground">
                  Detailed trends and analytics for your healthcare spending
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <AnalyticsSettings
                  assumptions={assumptions}
                  onUpdate={handleAssumptionsUpdate}
                />
              </div>
            </div>

            {hasData && (
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                <TimeRangeFilter
                  selectedRange={timeRange}
                  customDateRange={customDateRange}
                  onRangeChange={setTimeRange}
                  onCustomDateChange={setCustomDateRange}
                />
                <HSAAccountFilter
                  value={selectedHSAAccount}
                  onValueChange={setSelectedHSAAccount}
                />
              </div>
            )}
          </div>

          {!hasData ? (
            <AnalyticsEmptyState />
          ) : (
            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList className="inline-flex w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="insights">Spending Analysis</TabsTrigger>
                <TabsTrigger value="goals">Goals</TabsTrigger>
                <TabsTrigger value="tax">Tax Tools</TabsTrigger>
                <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
                <TabsTrigger value="ai">AI Analysis</TabsTrigger>
              </TabsList>

              <div className="flex justify-end">
                <ExportAnalytics
                  data={{
                    stats,
                    monthlyData,
                    categoryData,
                    paymentMethodsRewards,
                    yearlyData,
                  }}
                  dateRange={
                    timeRange === "ytd"
                      ? "Year to Date"
                      : timeRange === "last12"
                        ? "Last 12 Months"
                        : timeRange === "custom" && customDateRange?.from
                          ? `${customDateRange.from.toLocaleDateString()} - ${customDateRange.to?.toLocaleDateString() || ""}`
                          : "All Time"
                  }
                />
              </div>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid gap-4 md:gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        Total Invoiced
                      </CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        ${stats.totalExpenses.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        HSA Eligible
                      </CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        ${stats.hsaEligible.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        Projected Savings
                      </CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        ${stats.projectedSavings.toFixed(2)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Not yet reimbursed
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        Actual Savings
                      </CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        ${stats.actualSavings.toFixed(2)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        From reimbursements
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        Avg Monthly
                      </CardTitle>
                      <PieChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        ${stats.avgMonthly.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-6 lg:grid-cols-2 mb-8">
                  <Card>
                    <CardHeader>
                      <CardTitle>Monthly Bill Trend</CardTitle>
                      <CardDescription>Your bills over time</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {monthlyData.length === 0 ? (
                        <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground text-center px-4">
                          Add a few bills to see how your spending trends month
                          over month.
                        </div>
                      ) : (
                        <div
                          role="img"
                          aria-label="Line chart showing monthly bill trends over time. Displays total invoiced amounts for each month to help track spending patterns."
                        >
                          <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={monthlyData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--border))"
                              />
                              <XAxis
                                dataKey="month"
                                stroke="hsl(var(--muted-foreground))"
                                aria-label="Month"
                              />
                              <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                aria-label="Amount in dollars"
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "var(--radius)",
                                }}
                              />
                              <Legend />
                              <Line
                                type="monotone"
                                dataKey="total"
                                stroke="hsl(var(--primary))"
                                strokeWidth={2}
                                name="Total Invoiced"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Invoices by Category</CardTitle>
                      <CardDescription>
                        Breakdown of your invoices
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {categoryData.length === 0 ? (
                        <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground text-center px-4">
                          Add bills with categories to see your spending
                          breakdown.
                        </div>
                      ) : (
                        <div
                          role="img"
                          aria-label="Bar chart showing invoice amounts grouped by medical category. Each bar represents total spending in categories like Doctor Visits, Prescriptions, and Dental care."
                        >
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={categoryData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--border))"
                              />
                              <XAxis
                                dataKey="category"
                                stroke="hsl(var(--muted-foreground))"
                                aria-label="Medical category"
                              />
                              <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                aria-label="Amount in dollars"
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "var(--radius)",
                                }}
                              />
                              <Legend />
                              <Bar dataKey="total" name="Amount">
                                {categoryData.map((_entry, index) => (
                                  <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Category Distribution</CardTitle>
                    <CardDescription>Where your money goes</CardDescription>
                  </CardHeader>
                  <CardContent className="flex justify-center">
                    {categoryData.length === 0 ? (
                      <div className="flex items-center justify-center h-[400px] text-sm text-muted-foreground text-center px-4">
                        Once you add bills, the donut chart shows how much of
                        your spending falls into each category.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={400}>
                        <RechartsPie>
                          <Pie
                            data={categoryData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ category, percent }) =>
                              `${category}: ${(percent * 100).toFixed(0)}%`
                            }
                            outerRadius={120}
                            fill="hsl(var(--primary))"
                            dataKey="total"
                          >
                            {categoryData.map((_entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={COLORS[index % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "var(--radius)",
                            }}
                          />
                        </RechartsPie>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="insights" className="space-y-6 scroll-mt-6">
                <HSAInvestmentTracker
                  unreimbursedTotal={stats.unreimbursedHsaTotal}
                  investmentReturnRate={assumptions.investmentReturnRate}
                />

                <ReimbursementTimingOptimizer
                  unreimbursedTotal={stats.unreimbursedHsaTotal}
                  currentTaxBracket={assumptions.currentTaxBracket}
                  projectedTaxBracket={assumptions.projectedTaxBracket}
                />

                <RewardsOptimizationDashboard
                  paymentMethods={paymentMethodsRewards}
                />

                <PaymentStrategyTimeline expenses={[]} />
              </TabsContent>

              <TabsContent value="goals" className="space-y-6">
                <ErrorBoundary
                  fallbackTitle="Goals Unavailable"
                  fallbackDescription="We couldn't load your savings goals. Your other analytics are unaffected."
                >
                  <GoalSetting
                    currentStats={{
                      totalExpenses: stats.totalExpenses,
                      hsaEligible: stats.hsaEligible,
                      unreimbursedHsaTotal: stats.unreimbursedHsaTotal,
                      actualSavings: stats.actualSavings,
                    }}
                  />
                  <YearOverYearComparison yearlyData={yearlyData} />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="tax" className="space-y-6">
                <TaxPackageExport />
              </TabsContent>

              <TabsContent value="benchmarks" className="space-y-6">
                <Benchmarking
                  userStats={{
                    savingsRate:
                      (stats.hsaEligible / stats.totalExpenses) * 100,
                    rewardsRate: assumptions.defaultRewardsRate,
                    hsaUtilization:
                      (stats.hsaEligible / stats.totalExpenses) * 100,
                    avgMonthlyExpenses: stats.avgMonthly,
                  }}
                />
              </TabsContent>

              <TabsContent value="ai" className="space-y-6">
                <FeatureGate feature="ai_insights" requiredTier="premium">
                  <AIInsights
                    analyticsData={{
                      stats,
                      monthlyData,
                      categoryData,
                      paymentMethodsRewards,
                      yearlyData,
                    }}
                  />
                </FeatureGate>
              </TabsContent>
            </Tabs>
          )}
        </main>
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
};

export default Reports;
