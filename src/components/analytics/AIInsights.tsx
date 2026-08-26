import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { logError } from "@/utils/errorHandler";

interface AIInsightsProps {
  analyticsData: {
    stats: any;
    monthlyData: any[];
    categoryData: any[];
    paymentMethodsRewards: any[];
    yearlyData: any[];
  };
}

export const AIInsights = ({ analyticsData }: AIInsightsProps) => {
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const generateInsights = async () => {
    setLoading(true);
    try {
      // Prepare context for AI
      const context = {
        totalExpenses: analyticsData.stats.totalExpenses,
        hsaEligible: analyticsData.stats.hsaEligible,
        unreimbursedTotal: analyticsData.stats.unreimbursedHsaTotal,
        actualSavings: analyticsData.stats.actualSavings,
        topCategories: analyticsData.categoryData.slice(0, 3),
        rewardsData: analyticsData.paymentMethodsRewards,
        yearlyTrend:
          analyticsData.yearlyData.length > 1
            ? analyticsData.yearlyData[analyticsData.yearlyData.length - 1]
                .totalExpenses -
              analyticsData.yearlyData[analyticsData.yearlyData.length - 2]
                .totalExpenses
            : 0,
      };

      const { data, error } = await supabase.functions.invoke("wellbie-chat", {
        body: {
          message: `Based on this financial data, provide 3-5 specific, actionable insights to optimize HSA savings and rewards:
          
Total Medical Expenses: $${context.totalExpenses}
HSA-Eligible Amount: $${context.hsaEligible}
Unreimbursed HSA Balance: $${context.unreimbursedTotal}
Actual Savings Realized: $${context.actualSavings}
Top Expense Categories: ${context.topCategories.map((c) => `${c.category}: $${c.total}`).join(", ")}
Payment Methods: ${context.rewardsData.map((p) => `${p.name} (${p.rewardsRate}%)`).join(", ")}

Please provide insights in a numbered list format, focusing on:
1. Opportunities to increase savings
2. Better reward card utilization
3. Optimal reimbursement timing
4. Investment growth potential
5. Tax optimization strategies`,
          conversationId: null,
        },
      });

      if (error) throw error;

      // Parse the response into individual insights
      const responseText = data.response || "";
      const parsedInsights = responseText
        .split(/\d+\.\s/)
        .filter((insight: string) => insight.trim().length > 0)
        .slice(0, 5);

      setInsights(parsedInsights);
      toast.success("AI insights generated");
    } catch (error) {
      logError("Error generating insights", error);
      toast.error("Failed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI-Powered Insights
            </CardTitle>
            <CardDescription>
              Personalized recommendations based on your financial data
            </CardDescription>
          </div>
          <Button
            onClick={generateInsights}
            disabled={loading}
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading
              ? "Analyzing..."
              : insights.length > 0
                ? "Refresh"
                : "Generate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ))}
          </div>
        ) : insights.length > 0 ? (
          <div className="space-y-4">
            {insights.map((insight, index) => (
              <div
                key={index}
                className="p-4 bg-primary/5 border border-primary/20 rounded-lg"
              >
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-relaxed">{insight.trim()}</p>
                </div>
              </div>
            ))}

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground text-center">
                ✨ Powered by Reclaim AI • Insights refresh with your latest
                data
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">Get personalized recommendations</p>
            <p className="text-sm mt-1">
              Click "Generate" to receive AI-powered insights
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
