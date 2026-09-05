import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, TrendingDown, Calendar, DollarSign } from "lucide-react";

interface ReimbursementTimingOptimizerProps {
  unreimbursedTotal: number;
  // Required, not optional. These feed division directly, so an omitted
  // bracket rendered the whole card as NaN; and silently defaulting a tax
  // bracket would produce a plausible-looking but wrong savings figure,
  // which is worse. The only caller already passes both.
  currentTaxBracket: number;
  projectedTaxBracket: number;
}

export const ReimbursementTimingOptimizer = ({
  unreimbursedTotal,
  currentTaxBracket,
  projectedTaxBracket,
}: ReimbursementTimingOptimizerProps) => {
  const currentSavings = unreimbursedTotal * (currentTaxBracket / 100);
  const futureSavings = unreimbursedTotal * (projectedTaxBracket / 100);
  const savingsDifferential = futureSavings - currentSavings;

  const shouldWait = projectedTaxBracket > currentTaxBracket;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Smart Reimbursement Timing
        </CardTitle>
        <CardDescription>
          Optimize when you reimburse to maximize tax savings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Current Tax Bracket</p>
            <p className="text-2xl font-bold">{currentTaxBracket}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Projected Bracket</p>
            <p className="text-2xl font-bold">{projectedTaxBracket}%</p>
          </div>
        </div>

        <div className="pt-4 border-t">
          <div className="space-y-1 mb-4">
            <p className="text-sm text-muted-foreground">
              Unreimbursed HSA Balance
            </p>
            <Money
              value={unreimbursedTotal}
              className="block text-3xl font-bold"
            />
          </div>

          {shouldWait ? (
            <Alert className="border-primary/50 bg-primary/5">
              <TrendingUp className="h-4 w-4 text-primary" />
              <AlertDescription>
                <p className="font-semibold mb-2">💡 Wait to Reimburse</p>
                <p className="text-sm">
                  Your projected tax bracket is higher. By waiting to reimburse,
                  you could save an additional{" "}
                  <Money value={savingsDifferential} className="font-bold" /> in
                  taxes.
                </p>
                <p className="text-sm mt-2">
                  <span className="font-semibold">Current savings:</span>{" "}
                  {formatCurrency(currentSavings)}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">Future savings:</span>{" "}
                  {formatCurrency(futureSavings)}
                </p>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-orange-500/50 bg-orange-500/5">
              <TrendingDown className="h-4 w-4 text-orange-500" />
              <AlertDescription>
                <p className="font-semibold mb-2">⚡ Reimburse Soon</p>
                <p className="text-sm">
                  Your current tax bracket is higher. Consider reimbursing now
                  to maximize your tax savings of{" "}
                  <Money value={currentSavings} className="font-bold" />.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="pt-4 border-t space-y-2">
          <p className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Optimization Strategy
          </p>
          <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
            <li>Review your tax situation annually</li>
            <li>Consider life changes (job, retirement, etc.)</li>
            <li>Let investments grow tax-free while you wait</li>
            <li>Keep detailed records of all eligible expenses</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
