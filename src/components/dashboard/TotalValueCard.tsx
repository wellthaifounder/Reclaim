import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DollarSign, PiggyBank, Info, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface TotalValueCardProps {
  taxSavings: number;
  disputeSavings: number;
  rewardsEarned: number;
  paymentOptimizations: number;
  hasHSA: boolean;
  hsaClaimableAmount?: number;
  totalTracked?: number;
  billCount?: number;
}

export function TotalValueCard({
  taxSavings,
  hasHSA,
  hsaClaimableAmount = 0,
  totalTracked = 0,
  billCount = 0,
}: TotalValueCardProps) {
  const navigate = useNavigate();

  if (hasHSA) {
    return (
      <TooltipProvider>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Ready to Claim */}
          <Card
            interactive
            className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 hover:border-primary/40 transition-colors"
            onClick={() => navigate("/substantiation")}
          >
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Ready to Claim
                  </p>
                  <div className="text-3xl font-black text-foreground">
                    $
                    {hsaClaimableAmount.toLocaleString("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                    HSA-eligible expenses awaiting reimbursement
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
              </div>
              {hsaClaimableAmount > 0 && (
                <div className="mt-3 pt-3 border-t border-primary/10">
                  <span className="text-xs font-medium text-primary flex items-center gap-1">
                    Start a claim
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Potential Tax Savings */}
          <Card className="bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-500/20">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Potential Tax Savings
                    </p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64 text-xs">
                        Estimated at a 30% combined federal + state tax rate on
                        HSA-eligible expenses. Actual savings depend on your tax
                        bracket.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="text-3xl font-black text-foreground">
                    $
                    {taxSavings.toLocaleString("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Est. at 30% tax bracket on eligible expenses
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <PiggyBank className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>
    );
  }

  // Non-HSA users: Total Tracked + Bills count
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card className="bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Total Tracked
              </p>
              <div className="text-3xl font-black text-foreground">
                $
                {totalTracked.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Across all your medical expenses
              </p>
            </div>
            <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
              <DollarSign className="h-5 w-5 text-accent" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card
        interactive
        className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 hover:border-primary/40 transition-colors"
        onClick={() => navigate("/bills")}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Bills Tracked
              </p>
              <div className="text-3xl font-black text-foreground">
                {billCount}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Medical bills and receipts
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-primary/10">
            <span className="text-xs font-medium text-primary flex items-center gap-1">
              View all bills
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
