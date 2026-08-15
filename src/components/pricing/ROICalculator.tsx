import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, DollarSign } from "lucide-react";

export const ROICalculator = () => {
  const [monthlySpending, setMonthlySpending] = useState(500);

  // Conservative savings estimate: 15-25% average
  const averageSavingsRate = 0.2;
  const monthlySavings = monthlySpending * averageSavingsRate;

  // Calculate which plan pays for itself
  const plusCost = 19;
  const premiumCost = 49;

  const plusNetSavings = Math.max(0, monthlySavings - plusCost);
  const premiumNetSavings = Math.max(0, monthlySavings - premiumCost);

  const plusROI =
    plusNetSavings > 0 ? ((plusNetSavings / plusCost) * 100).toFixed(0) : "0";
  const premiumROI =
    premiumNetSavings > 0
      ? ((premiumNetSavings / premiumCost) * 100).toFixed(0)
      : "0";

  return (
    <div className="mx-auto max-w-3xl mb-12">
      <Card className="border-2 border-primary/20 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Calculate Your Savings</CardTitle>
          <CardDescription>
            See how much you could save on healthcare costs with Reclaim
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="spending-slider">
                Monthly Healthcare Spending
              </Label>
              <span className="text-2xl font-bold text-primary">
                ${monthlySpending}
              </span>
            </div>
            <Slider
              id="spending-slider"
              min={100}
              max={2000}
              step={50}
              value={[monthlySpending]}
              onValueChange={(value) => setMonthlySpending(value[0])}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>$100/mo</span>
              <span>$2,000/mo</span>
            </div>
          </div>

          <div className="pt-6 border-t space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span>
                Based on average 20% savings from error detection and
                optimization
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Plus Plan ROI */}
              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-semibold">Plus Plan</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Est. Monthly Savings:
                    </span>
                    <span className="font-medium">
                      ${monthlySavings.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subscription Cost:
                    </span>
                    <span className="font-medium">-${plusCost}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold pt-2 border-t">
                    <span>Net Monthly Savings:</span>
                    <span className="text-primary">
                      ${plusNetSavings.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-xs text-center text-muted-foreground pt-1">
                    {plusNetSavings > 0
                      ? `${plusROI}% ROI`
                      : "Increase spending for ROI"}
                  </div>
                </div>
              </div>

              {/* Premium Plan ROI */}
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-2">
                <h4 className="font-semibold">Premium Plan</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Est. Monthly Savings:
                    </span>
                    <span className="font-medium">
                      ${monthlySavings.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subscription Cost:
                    </span>
                    <span className="font-medium">-${premiumCost}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold pt-2 border-t">
                    <span>Net Monthly Savings:</span>
                    <span className="text-primary">
                      ${premiumNetSavings.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-xs text-center text-muted-foreground pt-1">
                    {premiumNetSavings > 0
                      ? `${premiumROI}% ROI`
                      : "Best for $250+/mo spending"}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground pt-2">
              Annual savings potential: ${(plusNetSavings * 12).toFixed(0)}{" "}
              (Plus) or ${(premiumNetSavings * 12).toFixed(0)} (Premium)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
