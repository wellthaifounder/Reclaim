import { Card, CardContent } from "@/components/ui/card";
import { formatCurrencyWhole } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface SpotlightCardProps {
  icon: string;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  variant?: "default" | "success" | "info";
}

function SpotlightCard({
  icon,
  title,
  description,
  cta,
  onClick,
  variant = "default",
}: SpotlightCardProps) {
  const variantStyles = {
    default: "from-primary/10 to-primary/5 border-primary/20",
    success:
      "from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800",
    info: "from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800",
  };

  return (
    <Card className={`bg-gradient-to-br ${variantStyles[variant]}`}>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <div className="text-4xl flex-shrink-0">{icon}</div>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h3 className="font-semibold text-lg mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {description}
              </p>
            </div>
            <Button
              onClick={onClick}
              size="sm"
              className="w-full sm:w-auto min-h-[44px]"
            >
              {cta}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ValueSpotlightProps {
  pendingReviews?: number;
  totalPotentialSavings?: number;
  recentDisputeWins?: number;
  disputeSavings?: number;
  onReviewClick: () => void;
  onDisputeClick: () => void;
  onProviderClick: () => void;
}

export function ValueSpotlight({
  pendingReviews = 0,
  totalPotentialSavings = 0,
  recentDisputeWins = 0,
  disputeSavings = 0,
  onReviewClick,
  onDisputeClick,
  onProviderClick,
}: ValueSpotlightProps) {
  const hasContent = pendingReviews > 0 || recentDisputeWins > 0;

  if (!hasContent) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-2xl">✨</span>
          Discover Value
        </h2>
        <SpotlightCard
          icon="🏥"
          title="Track Healthcare Providers"
          description="See which providers have the best billing accuracy and avoid problematic ones"
          cta="View Provider Ratings"
          onClick={onProviderClick}
          variant="info"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <span className="text-2xl">✨</span>
        Opportunities for You
      </h2>
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
        {pendingReviews > 0 && (
          <SpotlightCard
            icon="🔍"
            title="Potential Savings Found!"
            description={`${pendingReviews} bill${pendingReviews === 1 ? "" : "s"} with errors found${totalPotentialSavings > 0 ? ` - up to ${formatCurrencyWhole(totalPotentialSavings)} in potential savings` : ""}`}
            cta="Review Now"
            onClick={onReviewClick}
            variant="default"
          />
        )}

        {recentDisputeWins > 0 && (
          <SpotlightCard
            icon="🎉"
            title="Recent Wins"
            description={`You saved ${formatCurrencyWhole(disputeSavings)} from ${recentDisputeWins} successful dispute${recentDisputeWins === 1 ? "" : "s"} this month!`}
            cta="View Disputes"
            onClick={onDisputeClick}
            variant="success"
          />
        )}

        <SpotlightCard
          icon="🏥"
          title="Track Providers"
          description="See which providers have the best billing accuracy"
          cta="View Provider Ratings"
          onClick={onProviderClick}
          variant="info"
        />
      </div>
    </div>
  );
}
