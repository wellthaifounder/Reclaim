import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Zap } from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";

const ExpenseDecision = () => {
  const navigate = useNavigate();

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/dashboard")}
          className="mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Add a Medical Bill</h1>
          <p className="text-muted-foreground">
            Quick entry for all your medical expenses
          </p>
        </div>

        <div className="grid gap-6 max-w-xl mx-auto">
          <Card
            interactive
            className="hover:border-primary transition-all hover:shadow-lg group"
            onClick={() => navigate("/invoice/new")}
          >
            <CardHeader className="text-center pb-4">
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit group-hover:bg-primary/20 transition-colors">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-xl">Add Medical Bill</CardTitle>
              <CardDescription>Enter your medical expenses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground font-medium">
                Perfect for:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">✓</span>
                  <span>Doctor visits and copays</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">✓</span>
                  <span>Prescriptions and medications</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">✓</span>
                  <span>Medical procedures and treatments</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">✓</span>
                  <span>Over-the-counter medical purchases</span>
                </li>
              </ul>
              <div className="pt-4">
                <Button
                  className="w-full"
                  onClick={() => navigate("/invoice/new")}
                >
                  Add Bill
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 p-6 bg-muted/50 rounded-lg">
          <h3 className="font-semibold mb-2">
            💡 Track and optimize your medical expenses
          </h3>
          <p className="text-sm text-muted-foreground">
            Add all your medical bills to maximize your HSA reimbursement
            potential and track your healthcare spending.
          </p>
        </div>
      </div>
    </AuthenticatedLayout>
  );
};

export default ExpenseDecision;
