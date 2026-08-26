import { Card, CardContent } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";
import { WellbieChat } from "@/components/WellbieChat";

interface WellbieTipProps {
  unreviewedCount: number;
  hasExpenses: boolean;
}

export function WellbieTip({ unreviewedCount, hasExpenses }: WellbieTipProps) {
  const getTipMessage = () => {
    if (unreviewedCount > 0) {
      return `Reviewing those ${unreviewedCount} transactions will help track your savings accurately!`;
    }
    if (!hasExpenses) {
      return "Add your first medical bill to start tracking your healthcare savings!";
    }
    return "You're doing great! Keep tracking your expenses to maximize your HSA benefits.";
  };

  return (
    <>
      <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Lightbulb className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <p className="font-semibold text-amber-900 dark:text-amber-100">
                Wellbie Tip:
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {getTipMessage()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <WellbieChat />
    </>
  );
}
