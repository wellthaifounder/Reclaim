import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Award, TrendingUp, CreditCard } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface PaymentMethodRewards {
  name: string;
  rewardsEarned: number;
  rewardsRate: number;
  totalSpent: number;
  category?: string;
}

interface RewardsOptimizationDashboardProps {
  paymentMethods: PaymentMethodRewards[];
}

export const RewardsOptimizationDashboard = ({
  paymentMethods,
}: RewardsOptimizationDashboardProps) => {
  const totalRewards = paymentMethods.reduce(
    (sum, pm) => sum + pm.rewardsEarned,
    0,
  );
  const bestCard = paymentMethods.reduce(
    (best, current) =>
      current.rewardsEarned > best.rewardsEarned ? current : best,
    paymentMethods[0] || {
      name: "None",
      rewardsEarned: 0,
      rewardsRate: 0,
      totalSpent: 0,
    },
  );

  const chartData = paymentMethods.map((pm) => ({
    name: pm.name,
    rewards: pm.rewardsEarned,
    rate: pm.rewardsRate,
  }));

  const COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" />
          Rewards Optimization
        </CardTitle>
        <CardDescription>
          Maximize your rewards by using the right cards
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Total Rewards Earned
            </p>
            <p className="text-3xl font-bold text-primary">
              ${totalRewards.toFixed(2)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Top Earning Card</p>
            <p className="text-lg font-semibold">{bestCard.name}</p>
            <p className="text-sm text-muted-foreground">
              ${bestCard.rewardsEarned.toFixed(2)}
            </p>
          </div>
        </div>

        {paymentMethods.length > 0 && (
          <div
            className="h-64"
            role="img"
            aria-label="Bar chart showing rewards earned by payment method. Each bar represents total rewards accumulated from different credit cards or payment options, helping optimize which card to use."
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="name"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  aria-label="Payment method name"
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 12 }}
                  aria-label="Rewards earned in dollars"
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
                      const value =
                        typeof payload[0].value === "number"
                          ? payload[0].value
                          : 0;
                      return (
                        <div className="bg-popover border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">
                            {payload[0].payload.name}
                          </p>
                          <p className="text-sm">
                            Rewards: ${value.toFixed(2)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Rate: {payload[0].payload.rate}%
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="rewards"
                  radius={[8, 8, 0, 0]}
                  name="Rewards Earned"
                >
                  {chartData.map((_entry, index) => (
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

        <div className="pt-4 border-t space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Optimization Tips
          </p>
          {paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {paymentMethods
                .sort((a, b) => b.rewardsRate - a.rewardsRate)
                .slice(0, 3)
                .map((pm, index) => (
                  <div key={index} className="flex items-start gap-3 text-sm">
                    <CreditCard className="h-4 w-4 mt-0.5 text-primary" />
                    <div>
                      <p className="font-medium">{pm.name}</p>
                      <p className="text-muted-foreground">
                        {pm.rewardsRate}% rewards • ${pm.totalSpent.toFixed(2)}{" "}
                        spent
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add payment methods with rewards rates to see optimization
              suggestions
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
