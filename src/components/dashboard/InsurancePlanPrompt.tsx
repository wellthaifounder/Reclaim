import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrencyWhole } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Shield, Plus, TrendingDown } from "lucide-react";
import { InsurancePlanDialog } from "@/components/onboarding/InsurancePlanDialog";
import { useInsurancePlan } from "@/hooks/useInsurancePlan";
import { Progress } from "@/components/ui/progress";

interface InsurancePlanPromptProps {
  expenseCount: number;
}

export function InsurancePlanPrompt({
  expenseCount,
}: InsurancePlanPromptProps) {
  const [showDialog, setShowDialog] = useState(false);
  const {
    hasInsurancePlan,
    insurancePlan,
    deductibleRemaining,
    outOfPocketRemaining,
    deductibleMet,
    outOfPocketMet,
  } = useInsurancePlan();

  // Don't show prompt until user has uploaded 3+ bills
  // This defers insurance collection to reduce early friction
  if (!hasInsurancePlan && expenseCount < 3) {
    return null;
  }

  // Don't show if user hasn't added insurance plan
  if (!hasInsurancePlan) {
    return (
      <>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg">
                Get Accurate Deductible Tracking
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We've analyzed {expenseCount} bills for you. Add your insurance
              details to see exactly how much counts toward your deductible.
            </p>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <TrendingDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Track deductible progress automatically</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <TrendingDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>See personalized cost estimates</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <TrendingDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Understand out-of-pocket maximums</span>
              </div>
            </div>

            <Button onClick={() => setShowDialog(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Insurance Plan
            </Button>
          </CardContent>
        </Card>

        <InsurancePlanDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          onSuccess={() => window.location.reload()}
        />
      </>
    );
  }

  // Show insurance plan summary with deductible tracking
  const deductibleProgress =
    insurancePlan?.deductible && insurancePlan?.deductible_met
      ? (insurancePlan.deductible_met / insurancePlan.deductible) * 100
      : 0;

  const oopProgress =
    insurancePlan?.out_of_pocket_max && insurancePlan?.out_of_pocket_met
      ? (insurancePlan.out_of_pocket_met / insurancePlan.out_of_pocket_max) *
        100
      : 0;

  return (
    <>
      <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-lg">Insurance Plan</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {insurancePlan?.carrier} •{" "}
                  {insurancePlan?.plan_type.toUpperCase()}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDialog(true)}
            >
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Deductible Progress */}
          {deductibleRemaining !== null && insurancePlan?.deductible && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">
                  Annual Deductible
                  {deductibleMet && " ✓"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatCurrencyWhole(deductibleRemaining)} remaining
                </span>
              </div>
              <Progress value={deductibleProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {formatCurrencyWhole(insurancePlan.deductible_met ?? 0)} of{" "}
                {formatCurrencyWhole(insurancePlan.deductible)} met
              </p>
            </div>
          )}

          {/* Out-of-Pocket Progress */}
          {outOfPocketRemaining !== null &&
            insurancePlan?.out_of_pocket_max && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">
                    Out-of-Pocket Max
                    {outOfPocketMet && " ✓"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatCurrencyWhole(outOfPocketRemaining)} remaining
                  </span>
                </div>
                <Progress value={oopProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {formatCurrencyWhole(insurancePlan.out_of_pocket_met ?? 0)} of{" "}
                  {formatCurrencyWhole(insurancePlan.out_of_pocket_max)} met
                </p>
              </div>
            )}

          {/* Alert if close to deductible */}
          {deductibleRemaining !== null &&
            deductibleRemaining > 0 &&
            deductibleRemaining < 500 && (
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-md">
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  💡 You're only {formatCurrencyWhole(deductibleRemaining)} away
                  from meeting your deductible!
                </p>
              </div>
            )}
        </CardContent>
      </Card>

      <InsurancePlanDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onSuccess={() => window.location.reload()}
      />
    </>
  );
}
