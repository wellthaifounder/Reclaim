import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

interface StatsProps {
  taxSavings: number;
  hsaClaimable: number;
  rewardsEarned: number;
  totalExpenses: number;
  disputeSavings: number;
  hasHSA: boolean;
}

export function FriendlyStatsCards({
  taxSavings,
  hsaClaimable,
  rewardsEarned,
  totalExpenses,
  disputeSavings,
  hasHSA,
}: StatsProps) {
  if (hasHSA) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
          <CardContent className="pt-6">
            <div className="text-3xl mb-2">🎉</div>
            <Money
              value={taxSavings}
              whole
              className="block text-2xl font-bold mb-1"
            />
            <p className="text-sm text-muted-foreground font-medium">
              Tax Savings
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              this quarter from HSA!
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="text-3xl mb-2">💰</div>
            <Money
              value={hsaClaimable}
              whole
              className="block text-2xl font-bold mb-1"
            />
            <p className="text-sm text-muted-foreground font-medium">
              Ready to Claim
            </p>
            <p className="text-xs text-muted-foreground mt-1">from your HSA</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
          <CardContent className="pt-6">
            <div className="text-3xl mb-2">🏆</div>
            <Money
              value={rewardsEarned}
              whole
              className="block text-2xl font-bold mb-1"
            />
            <p className="text-sm text-muted-foreground font-medium">
              Rewards Earned
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              from credit cards
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Non-HSA users see different stats
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="text-3xl mb-2">💵</div>
          <Money
            value={totalExpenses}
            whole
            className="block text-2xl font-bold mb-1"
          />
          <p className="text-sm text-muted-foreground font-medium">
            Total Tracked
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            healthcare expenses
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="text-3xl mb-2">🎉</div>
          <Money
            value={disputeSavings}
            whole
            className="block text-2xl font-bold mb-1"
          />
          <p className="text-sm text-muted-foreground font-medium">
            Money Saved
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            from disputes & optimization
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
        <CardContent className="pt-6">
          <div className="text-3xl mb-2">🏆</div>
          <Money
            value={rewardsEarned}
            whole
            className="block text-2xl font-bold mb-1"
          />
          <p className="text-sm text-muted-foreground font-medium">
            Rewards Earned
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            from credit cards
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
