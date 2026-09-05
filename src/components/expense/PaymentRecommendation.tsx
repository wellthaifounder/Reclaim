import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { TrendingUp, CreditCard, Lightbulb } from "lucide-react";
import { PaymentRecommendation as PaymentRec } from "@/lib/paymentRecommendation";

interface PaymentRecommendationProps {
  recommendation: PaymentRec;
  className?: string;
}

export const PaymentRecommendation = ({
  recommendation,
  className = "",
}: PaymentRecommendationProps) => {
  const getIcon = () => {
    switch (recommendation.method) {
      case "hsa-invest":
        return <TrendingUp className="h-5 w-5 text-primary" />;
      case "rewards-card":
        return <CreditCard className="h-5 w-5 text-primary" />;
      default:
        return <Lightbulb className="h-5 w-5 text-primary" />;
    }
  };

  return (
    <Card className={`border-primary/20 bg-primary/5 ${className}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-2">
            {getIcon()}
            <div>
              <h3 className="font-semibold text-sm">{recommendation.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {recommendation.description}
              </p>
            </div>
          </div>
        </div>

        {recommendation.savingsAmount > 0 && (
          <div className="space-y-2">
            <div className="bg-background/50 rounded-lg p-3 border border-primary/10">
              <Money
                value={recommendation.savingsAmount}
                className="block text-2xl font-bold text-primary"
              />
              <div className="text-xs text-muted-foreground">
                Estimated Total Savings
              </div>
            </div>

            {recommendation.breakdown && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Savings Breakdown
                </p>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rewards:</span>
                    <Money
                      value={recommendation.breakdown.rewards}
                      className="font-medium"
                    />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax Savings:</span>
                    <Money
                      value={recommendation.breakdown.taxSavings}
                      className="font-medium text-green-600"
                    />
                  </div>
                  {recommendation.breakdown.timingBenefit > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Timing Growth:
                      </span>
                      <Money
                        value={recommendation.breakdown.timingBenefit}
                        className="font-medium"
                      />
                    </div>
                  )}
                  {recommendation.breakdown.investmentGrowth > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Long-term Growth:
                      </span>
                      <Money
                        value={recommendation.breakdown.investmentGrowth}
                        className="font-medium"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          {recommendation.reasoning.map((reason, index) => (
            <div key={index} className="flex items-start gap-2 text-xs">
              <span className="text-primary mt-0.5">•</span>
              <span className="text-muted-foreground">{reason}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
