import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  DollarSign,
} from "lucide-react";

interface EmptyStateOnboardingProps {
  projectedSavings?: number;
}

// Wave 5 (2026-05-06): The HSA opened-date prompt that used to live here was
// removed — it now collects lazily via MissingHSADateBanner after the user
// uploads their first bill. With everyone defaulting to userIntent='both' the
// upfront prompt would have shown for every new user before they had any
// reason to care (review §A1.2 / §A4.8). The empty state now leads with the
// projection (if any) and a single "Upload Your First Bill" CTA.
export function EmptyStateOnboarding({
  projectedSavings,
}: EmptyStateOnboardingProps) {
  const navigate = useNavigate();

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="pt-8 pb-8">
        <div className="text-center space-y-6 max-w-2xl mx-auto">
          {/* Show personalized projection if available from calculator */}
          {projectedSavings && projectedSavings > 0 ? (
            <div className="bg-accent/20 p-6 rounded-lg mb-6 border-2 border-accent/30">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-accent-foreground" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-accent mb-2">
                ${projectedSavings.toLocaleString()}/year
              </h2>
              <p className="text-sm text-muted-foreground">
                Your Personalized Savings Projection
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Based on your calculator results. Start tracking expenses to put
                this into action.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <h2 className="text-2xl font-bold">
              {projectedSavings
                ? "Let's Start Tracking"
                : "Start Saving on Healthcare Today"}
            </h2>
            <p className="text-muted-foreground">
              Upload your first expense and see how Reclaim organizes everything
              for you.
            </p>
          </div>

          <div className="bg-accent/10 rounded-lg p-6 border border-accent/20">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center">
                <Upload className="h-6 w-6 text-accent" />
              </div>
              <div className="h-1 w-12 bg-accent/30 rounded" />
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="h-1 w-12 bg-muted rounded" />
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-4 text-left">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-accent-foreground">
                    1
                  </span>
                </div>
                <div>
                  <p className="font-semibold">Upload Your First Bill</p>
                  <p className="text-sm text-muted-foreground">
                    Take 30 seconds. Upload any medical bill, EOB, or receipt.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-muted-foreground">
                    2
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-muted-foreground">
                    Organize & Categorize
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reclaim auto-categorizes expenses and helps you organize
                    them into collections.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-muted-foreground">
                    3
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-muted-foreground">
                    Complete Setup
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Connect your bank and HSA to unlock automated tracking.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              size="lg"
              onClick={() => navigate("/expenses/new")}
              className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Your First Bill
            </Button>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <span>
                HSA holders save an average of{" "}
                <strong className="text-foreground">$1,800/year</strong> in
                taxes
              </span>
            </div>
          </div>

          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-3">
              Already have bills to track?
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/bank-accounts")}
            >
              Connect Bank Instead
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
