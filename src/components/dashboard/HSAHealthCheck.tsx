import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  PiggyBank,
  TrendingUp,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { HSA_LIMITS_2025 } from "@/lib/regulatoryLimits";

interface HSAHealthCheckProps {
  hasHSA: boolean;
  hsaBalance?: number;
  ytdContributions?: number;
  maxContribution?: number;
  unreimbursedExpenses?: number;
  investedAmount?: number;
  investedPercentage?: number;
}

export function HSAHealthCheck({
  hasHSA,
  hsaBalance = 0,
  ytdContributions = 0,
  maxContribution = HSA_LIMITS_2025.selfOnly, // 2025 individual limit
  unreimbursedExpenses = 0,
  investedAmount = 0,
  investedPercentage = 0,
}: HSAHealthCheckProps) {
  const navigate = useNavigate();

  // For non-HSA users, show eligibility checker
  if (!hasHSA) {
    return (
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg">
                Are You Eligible for an HSA?
              </CardTitle>
              <CardDescription className="mt-1">
                Save thousands in taxes this year
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            If you have a High Deductible Health Plan (HDHP), you could save
            $1,000+ in taxes annually with an HSA.
          </p>

          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <span>
                Tax-free contributions and withdrawals for medical expenses
              </span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <span>Invest and grow your balance tax-free</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <span>Reimburse yourself years later for tax-free growth</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => navigate("/hsa-eligibility")}
              className="flex-1"
              size="sm"
            >
              Check Eligibility
            </Button>
            <Button
              onClick={() => navigate("/settings")}
              variant="outline"
              className="flex-1"
              size="sm"
            >
              Connect HSA
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // For HSA users, calculate health metrics
  const hasBalanceData = hsaBalance > 0 || ytdContributions > 0;
  const contributionProgress = (ytdContributions / maxContribution) * 100;
  const contributionRemaining = maxContribution - ytdContributions;
  const cashPercentage =
    hsaBalance > 0 ? ((hsaBalance - investedAmount) / hsaBalance) * 100 : 0;

  // Determine health status — only flag contribution/investment issues when we have real data
  const issues: string[] = [];
  if (hasBalanceData && contributionProgress < 80) {
    issues.push(
      `You're $${contributionRemaining.toFixed(0)} short of maxing out your HSA contribution`,
    );
  }
  if (hasBalanceData && investedPercentage < 50 && hsaBalance > 1000) {
    issues.push(
      `${cashPercentage.toFixed(0)}% of your HSA is uninvested (missing growth potential)`,
    );
  }
  if (unreimbursedExpenses > 500) {
    issues.push(
      `You have $${unreimbursedExpenses.toFixed(0)} in unreimbursed expenses`,
    );
  }

  const isHealthy = issues.length === 0;
  const statusColor = isHealthy
    ? "text-green-600 dark:text-green-400 bg-green-500/10"
    : "text-amber-600 dark:text-amber-400 bg-amber-500/10";

  return (
    <Card
      className={`border-2 ${isHealthy ? "border-green-200 dark:border-green-800" : "border-amber-200 dark:border-amber-800"}`}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-full flex items-center justify-center ${statusColor}`}
            >
              {isHealthy ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg">HSA Health Check</CardTitle>
              <CardDescription className="mt-1">
                {isHealthy ? "✅ On Track" : "⚠️ Needs Attention"}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* HSA Balance */}
        {hasBalanceData ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Balance</span>
                <span className="text-lg font-bold">
                  ${hsaBalance.toLocaleString()}
                </span>
              </div>
              {investedAmount > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-3 w-3" />
                  <span>
                    ${investedAmount.toLocaleString()} invested (
                    {investedPercentage}% of balance)
                  </span>
                </div>
              )}
            </div>

            {/* Contribution Progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">YTD Contributions</span>
                <span className="text-sm font-bold">
                  ${ytdContributions.toFixed(0)} / ${maxContribution.toFixed(0)}
                </span>
              </div>
              <Progress value={contributionProgress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {contributionProgress.toFixed(0)}% of 2024 max
              </p>
            </div>
          </>
        ) : (
          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            Connect your HSA provider in{" "}
            <button
              className="underline underline-offset-2 font-medium text-foreground"
              onClick={() => navigate("/settings")}
            >
              Settings
            </button>{" "}
            to see your balance and contribution data here.
          </div>
        )}

        {/* Unreimbursed Expenses */}
        {unreimbursedExpenses > 0 && (
          <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
            <div className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium">Unreimbursed Expenses</span>
            </div>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              ${unreimbursedExpenses.toLocaleString()}
            </span>
          </div>
        )}

        {/* Issues/Actions */}
        {!isHealthy && issues.length > 0 && (
          <div className="space-y-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
              Optimization Opportunities:
            </p>
            <ul className="space-y-1">
              {issues.map((issue, index) => (
                <li
                  key={index}
                  className="text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
                >
                  <span className="mt-0.5">•</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={() => navigate("/savings-calculator")}
          variant={isHealthy ? "outline" : "default"}
          className="w-full"
          size="sm"
        >
          {isHealthy ? "Open HSA Calculator" : "Optimize My HSA →"}
        </Button>
      </CardContent>
    </Card>
  );
}
