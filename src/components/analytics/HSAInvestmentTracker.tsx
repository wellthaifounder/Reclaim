import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, DollarSign, Calendar } from "lucide-react";
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
import { HSA_LIMITS_2025 } from "@/lib/regulatoryLimits";
import { Money } from "@/components/ui/money";
import { formatCurrency, formatCurrencyWhole } from "@/lib/utils";

interface HSAInvestmentTrackerProps {
  unreimbursedTotal: number;
  yearlyContributions?: number;
}

interface ExtendedHSAInvestmentTrackerProps extends HSAInvestmentTrackerProps {
  investmentReturnRate?: number;
}

export const HSAInvestmentTracker = ({
  unreimbursedTotal,
  yearlyContributions: _yearlyContributions = 0,
  investmentReturnRate = 7,
}: ExtendedHSAInvestmentTrackerProps) => {
  // Calculate investment growth projections
  const calculateGrowth = (
    principal: number,
    years: number,
    rate: number = investmentReturnRate / 100,
  ) => {
    return principal * Math.pow(1 + rate, years);
  };

  // Generate projection data for next 10 years
  const projectionData = Array.from({ length: 11 }, (_, i) => {
    const growth = calculateGrowth(unreimbursedTotal, i);
    const withReimbursement = unreimbursedTotal; // Stays constant as it's already spent

    return {
      year: i === 0 ? "Now" : `${i}y`,
      invested: Math.round(growth),
      reimbursed: withReimbursement,
      benefit: Math.round(growth - withReimbursement),
    };
  });

  const tenYearGrowth = calculateGrowth(unreimbursedTotal, 10);
  const totalBenefit = tenYearGrowth - unreimbursedTotal;

  // Calculate HSA contribution limits
  const currentYear = new Date().getFullYear();
  const HSA_LIMIT_INDIVIDUAL = HSA_LIMITS_2025.selfOnly;
  const HSA_LIMIT_FAMILY = HSA_LIMITS_2025.family;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>HSA Investment Growth Potential</CardTitle>
              <CardDescription>
                The power of delaying reimbursement while HSA funds grow
                tax-free
              </CardDescription>
            </div>
            <TrendingUp className="h-8 w-8 text-primary" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 p-4 border rounded-lg bg-accent/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                Unreimbursed Balance
              </div>
              <Money
                value={unreimbursedTotal}
                className="block text-2xl font-bold"
              />
              <p className="text-xs text-muted-foreground">
                Available for future reimbursement
              </p>
            </div>

            <div className="space-y-2 p-4 border rounded-lg bg-primary/5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                10-Year Projected Value
              </div>
              <Money
                value={tenYearGrowth}
                className="block text-2xl font-bold text-primary"
              />
              <p className="text-xs text-muted-foreground">
                At {investmentReturnRate}% annual growth
              </p>
            </div>

            <div className="space-y-2 p-4 border rounded-lg bg-green-500/5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Additional Benefit
              </div>
              <div className="text-2xl font-bold text-green-600">
                +<Money value={totalBenefit} />
              </div>
              <p className="text-xs text-muted-foreground">
                From investment growth
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Growth Projection Over Time</h4>
            <div
              role="img"
              aria-label="Line chart comparing HSA investment growth vs immediate reimbursement over time. Shows projected balance if money is invested versus if reimbursed immediately each year."
            >
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={projectionData}>
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
                    aria-label="Balance in dollars"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      boxShadow: "var(--shadow-lg)",
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: "20px" }} />
                  <Line
                    type="monotone"
                    dataKey="invested"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    name="HSA Balance (Invested)"
                    dot={{ fill: "hsl(var(--primary))", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="reimbursed"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="If Reimbursed Now"
                    dot={{ fill: "hsl(var(--muted-foreground))", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-accent/30 p-4 rounded-lg space-y-2">
            <h4 className="font-semibold text-sm">💡 Pro Strategy Explained</h4>
            <p className="text-sm text-muted-foreground">
              Instead of reimbursing yourself immediately, let your HSA funds
              stay invested and grow tax-free. Pay for medical expenses with a
              rewards credit card to earn points/cash back. Then, reimburse
              yourself years later when you need the cash - by then, your HSA
              has grown significantly through market returns!
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold mb-2 text-sm">Example Scenario</h4>
              <p className="text-sm text-muted-foreground mb-3">
                You have {formatCurrencyWhole(unreimbursedTotal)} in
                unreimbursed HSA expenses today.
              </p>
              <ul className="text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span>
                    Reimburse now: Get {formatCurrency(unreimbursedTotal)}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">→</span>
                  <span>
                    Wait 10 years: Get {formatCurrency(tenYearGrowth)} (
                    {formatCurrency(totalBenefit)} extra!)
                  </span>
                </li>
              </ul>
            </div>

            <div className="p-4 border rounded-lg bg-primary/5">
              <h4 className="font-semibold mb-2 text-sm">
                Annual Contribution Limits ({currentYear})
              </h4>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Individual Coverage
                  </p>
                  <p className="text-lg font-bold">
                    ${HSA_LIMIT_INDIVIDUAL.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Family Coverage
                  </p>
                  <p className="text-lg font-bold">
                    ${HSA_LIMIT_FAMILY.toLocaleString()}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Additional $1,000 catch-up contribution if age 55+
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
