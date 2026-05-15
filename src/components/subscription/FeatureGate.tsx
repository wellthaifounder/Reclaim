import React from "react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface FeatureGateProps {
  requiredTier: "plus" | "premium";
  feature: string;
  description?: string;
  children: React.ReactNode;
  blur?: boolean;
}

const TIER_LABELS: Record<string, string> = {
  plus: "Plus",
  premium: "Premium",
};

const FEATURE_LABELS: Record<string, string> = {
  ai_insights: "AI Insights",
};

export const FeatureGate: React.FC<FeatureGateProps> = ({
  requiredTier,
  feature,
  description,
  children,
}) => {
  const { checkFeatureAccess, createCheckoutSession, loading } =
    useSubscription();

  const hasAccess = checkFeatureAccess(requiredTier);

  if (loading) {
    return <div className="animate-pulse bg-muted h-32 rounded-lg" />;
  }

  if (!hasAccess) {
    const tierLabel = TIER_LABELS[requiredTier] || requiredTier;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {FEATURE_LABELS[feature] ?? feature}
              </p>
              <p className="text-xs text-muted-foreground">
                {description || `Upgrade to ${tierLabel} to unlock full access`}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => createCheckoutSession(requiredTier)}
            className="shrink-0"
          >
            Upgrade
          </Button>
        </div>
        <div className="pointer-events-none select-none opacity-60">
          {children}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
