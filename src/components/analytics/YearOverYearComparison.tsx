import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, Calendar, DollarSign, Percent } from "lucide-react";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface YearlyStats {
  year: number;
  totalExpenses: number;
  taxSavings: number;
  rewardsEarned: number;
  hsaEligible: number;
}

interface YearOverYearComparisonProps {
  yearlyData: YearlyStats[];
}

export const YearOverYearComparison = ({
  yearlyData,
}: YearOverYearComparisonProps) => {
  if (yearlyData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Year-over-Year Comparison
          </CardTitle>
          <CardDescription>Track your savings growth over time</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Start tracking expenses to see your year-over-year savings trends
            and growth patterns.
          </p>
        </CardContent>
      </Card>
    );
  }

  const currentYear = yearlyData[yearlyData.length - 1];
  const previousYear =
    yearlyData.length > 1 ? yearlyData[yearlyData.length - 2] : null;

  const savingsGrowth = previousYear
    ? currentYear.taxSavings +
      currentYear.rewardsEarned -
      (previousYear.taxSavings + previousYear.rewardsEarned)
    : 0;
  const savingsGrowthPercent = previousYear
    ? (savingsGrowth / (previousYear.taxSavings + previousYear.rewardsEarned)) *
      100
    : 0;

  const chartData = yearlyData.map((year) => ({
    year: year.year.toString(),
    totalSavings: year.taxSavings + year.rewardsEarned,
    taxSavings: year.taxSavings,
    rewards: year.rewardsEarned,
    expenses: year.totalExpenses,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Year-over-Year Comparison
        </CardTitle>
        <CardDescription>Track your savings growth over time</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Total Savings ({currentYear.year})
            </p>
            <Money
              value={currentYear.taxSavings + currentYear.rewardsEarned}
              className="block text-2xl font-bold"
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Growth vs Last Year
            </p>
            <p
              className={`text-2xl font-bold ${savingsGrowth >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {savingsGrowth >= 0 ? "+" : ""}
              {savingsGrowth.toFixed(2)}
            </p>
            {previousYear && (
              <p className="text-xs text-muted-foreground">
                {savingsGrowthPercent >= 0 ? "+" : ""}
                {savingsGrowthPercent.toFixed(1)}%
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Percent className="h-3 w-3" />
              Savings Rate
            </p>
            <p className="text-2xl font-bold">
              {currentYear.totalExpenses > 0
                ? (
                    ((currentYear.taxSavings + currentYear.rewardsEarned) /
                      currentYear.totalExpenses) *
                    100
                  ).toFixed(1)
                : 0}
              %
            </p>
          </div>
        </div>

        <div
          className="h-80"
          role="img"
          aria-label="Line chart comparing year-over-year savings trends. Shows total savings, tax savings, and rewards earned across multiple years to track financial progress over time."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.3}
              />
              <XAxis
                dataKey="year"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
                aria-label="Year"
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
                aria-label="Amount in dollars"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow-lg)",
                }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-popover border rounded-lg p-3 shadow-lg">
                        <p className="font-semibold mb-2">
                          {payload[0].payload.year}
                        </p>
                        <div className="space-y-1 text-sm">
                          <p style={{ color: "hsl(var(--primary))" }}>
                            Total Savings:{" "}
                            {formatCurrency(payload[0].payload.totalSavings)}
                          </p>
                          <p style={{ color: "hsl(var(--chart-2))" }}>
                            Tax Savings:{" "}
                            {formatCurrency(payload[0].payload.taxSavings)}
                          </p>
                          <p style={{ color: "hsl(var(--chart-3))" }}>
                            Rewards:{" "}
                            {formatCurrency(payload[0].payload.rewards)}
                          </p>
                          <p className="text-muted-foreground">
                            Expenses:{" "}
                            {formatCurrency(payload[0].payload.expenses)}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend wrapperStyle={{ paddingTop: "20px" }} />
              <Line
                type="monotone"
                dataKey="totalSavings"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                name="Total Savings"
                dot={{ fill: "hsl(var(--primary))", r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="taxSavings"
                stroke="hsl(var(--chart-2))"
                strokeWidth={2}
                name="Tax Savings"
                dot={{ fill: "hsl(var(--chart-2))", r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="rewards"
                stroke="hsl(var(--chart-3))"
                strokeWidth={2}
                name="Rewards"
                dot={{ fill: "hsl(var(--chart-3))", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="pt-4 border-t space-y-2">
          <p className="text-sm font-semibold">Key Insights</p>
          <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
            {yearlyData.length > 1 && savingsGrowth > 0 && (
              <li>
                You're saving {formatCurrency(savingsGrowth)} more this year -
                great progress! 🎉
              </li>
            )}
            {currentYear.hsaEligible > 0 && (
              <li>
                {formatCurrency(currentYear.hsaEligible)} in HSA-eligible
                expenses tracked this year
              </li>
            )}
            {yearlyData.length >= 3 && (
              <li>
                Multi-year tracking shows your optimization strategy is working
              </li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
