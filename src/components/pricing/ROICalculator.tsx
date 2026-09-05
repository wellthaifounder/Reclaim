import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, DollarSign } from "lucide-react";

export const ROICalculator = () => {
  const [monthlySpending, setMonthlySpending] = useState(500);

  // This is an assumption, not a measured average across users -- said
  // plainly in the caption below rather than implying a sourced statistic.
  const assumedSavingsRate = 0.2;
  const monthlySavings = monthlySpending * assumedSavingsRate;

  return (
    <div className="mx-auto max-w-3xl mb-12">
      <Card className="border-2 border-primary/20 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Calculate Your Savings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="spending-slider">
                Monthly Healthcare Spending
              </Label>
              {/* text-foreground, not text-primary -- primary is reserved
                  below for what Reclaim gets back, so what you typed and
                  what the app computed are never the same color. */}
              <span className="text-2xl font-bold text-foreground tabular-nums">
                ${monthlySpending}/mo
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

          {/* This used to show Plus's and Premium's net-of-subscription
              savings side by side as two same-style green numbers. Three
              independent blind design reviews in a row read that as "the
              pricier plan is the worse deal" no matter how the numbers were
              labeled or captioned -- relabeling twice didn't fix it, because
              the problem was the shape (two adjacent dollar figures, one
              smaller), not the wording. Comparing Plus vs. Premium is what
              the pricing cards below already do, through their feature
              lists, which is a comparison Premium can actually win. This
              card's only job now is the one honest number a calculator can
              give before you've connected anything: a rough sense of what's
              on the table. */}
          <div className="pt-6 border-t text-center space-y-1">
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Reclaim estimates you're leaving this much unclaimed
            </p>
            <p className="text-3xl font-bold text-primary tabular-nums">
              ${monthlySavings.toFixed(0)}
              <span className="text-sm font-medium text-muted-foreground">
                {" "}
                /mo
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Assumes 20% of your medical spending is reimbursable but unclaimed
              -- an estimate, not a measured average. Compare plans below to see
              what fits.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
