import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, DollarSign, TrendingUp, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

interface HSAUpgradePromptProps {
  /**
   * The specific expense amount this prompt is related to
   */
  expenseAmount?: number;

  /**
   * Where the prompt is being shown (for analytics)
   */
  context: "bill-detail" | "calculator" | "transaction";

  /**
   * Callback when user connects HSA
   */
  onConnect?: () => void;

  /**
   * Custom title override
   */
  title?: string;

  /**
   * Visual variant
   */
  variant?: "default" | "compact";
}

export function HSAUpgradePrompt({
  expenseAmount,
  context: _context,
  onConnect,
  title,
  variant = "default",
}: HSAUpgradePromptProps) {
  const navigate = useNavigate();
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  // Calculate example savings based on expense amount
  const taxSavings = expenseAmount ? Math.round(expenseAmount * 0.3) : 300;
  const investmentGrowth = expenseAmount
    ? Math.round(expenseAmount * 0.07 * 5)
    : 102;
  const totalBenefit = taxSavings + investmentGrowth;

  const handleConnect = () => {
    if (onConnect) {
      onConnect();
    } else {
      navigate("/settings");
    }
  };

  if (variant === "compact") {
    return (
      <div className="relative">
        <button
          onClick={() => setIsDismissed(true)}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
        <Card className="bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20 border-dashed">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold mb-1">
                  💡 HSA Tip: Save ${totalBenefit} More
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  This expense qualifies for HSA tax benefits. Connect your HSA
                  to unlock savings.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    className="h-8 text-xs"
                  >
                    Connect HSA
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate("/guide")}
                    className="h-8 text-xs"
                  >
                    Learn More
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsDismissed(true)}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
        aria-label="Dismiss"
      >
        ✕
      </button>
      <Card className="bg-gradient-to-br from-accent/5 via-accent/10 to-blue-500/5 border-accent/30 border-2 border-dashed overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
              <Sparkles className="h-6 w-6 text-accent" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">
                {title || "💡 HSA Optimization Available"}
              </CardTitle>
              <CardDescription className="mt-1">
                This expense qualifies for HSA tax benefits
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your HSA to unlock:
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-background/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-medium">Tax savings (30%)</span>
                </div>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  ${taxSavings}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 bg-background/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium">
                    Investment growth (5 yrs)
                  </span>
                </div>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  ${investmentGrowth}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-accent/10 rounded-lg border border-accent/20">
              <span className="text-sm font-semibold">
                Total Additional Benefit
              </span>
              <span className="text-xl font-black text-accent">
                ${totalBenefit}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Track reimbursable expenses automatically</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Optimize payment timing for maximum growth</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              <span>One-click reimbursement submission</span>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleConnect} className="flex-1">
              🔗 Connect HSA Account
            </Button>
            <Button variant="outline" onClick={() => navigate("/guide")}>
              Learn More
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
