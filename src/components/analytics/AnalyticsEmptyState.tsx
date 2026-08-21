import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, DollarSign, Calendar, Award, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const AnalyticsEmptyState = () => {
  const navigate = useNavigate();

  const sampleInsights = [
    {
      icon: DollarSign,
      title: "Track HSA-Eligible Expenses",
      description:
        "Keep receipts for medical expenses. You can reimburse yourself years later while your HSA grows tax-free.",
      color: "text-primary",
    },
    {
      icon: TrendingUp,
      title: "Maximize Investment Growth",
      description:
        "A $5,000 unreimbursed expense invested at 7% annual return could grow to $9,835 in 10 years—that's nearly $5,000 extra!",
      color: "text-green-600",
    },
    {
      icon: Award,
      title: "Optimize Rewards Cards",
      description:
        "Pay medical expenses with rewards cards, then reimburse from your HSA later. Earn 2-5% cash back on every medical expense.",
      color: "text-accent",
    },
    {
      icon: Calendar,
      title: "Time Your Reimbursements",
      description:
        "Reimburse during higher tax bracket years to maximize savings. Strategic timing can add hundreds to your benefit.",
      color: "text-blue-600",
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-2 border-dashed">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Info className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">
            Start Your Health Savings Journey
          </CardTitle>
          <CardDescription className="text-base">
            Add your first bill or expense to unlock powerful analytics and
            savings insights
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => navigate("/bills/new")}
              size="lg"
              className="gap-2"
            >
              <DollarSign className="h-4 w-4" />
              Upload Your First Bill
            </Button>
            <Button
              onClick={() => navigate("/expenses?tab=review")}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <Calendar className="h-4 w-4" />
              Connect Bank Account
            </Button>
          </div>

          <div className="pt-6 border-t">
            <h3 className="font-semibold text-center mb-4">
              What You'll Discover
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {sampleInsights.map((insight, index) => {
                const Icon = insight.icon;
                return (
                  <div
                    key={index}
                    className="flex gap-3 p-4 rounded-lg bg-muted/50"
                  >
                    <div className={`${insight.color} mt-0.5`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm mb-1">
                        {insight.title}
                      </h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {insight.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 text-center">
            <p className="text-sm font-medium mb-1">💡 Pro Tip</p>
            <p className="text-sm text-muted-foreground">
              Start by adding historical medical expenses from the past year.
              Even old receipts count for HSA reimbursement!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
