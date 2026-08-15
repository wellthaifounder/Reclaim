import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalculatorData } from "@/pages/Calculator";
import { calculateSavings } from "@/lib/savingsCalculator";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ResultsScreenProps {
  data: CalculatorData;
}

const getPersonalizedMessage = (data: CalculatorData): string => {
  if (data.trackingMethod === "none") {
    return "You're not tracking medical expenses yet — Reclaim gives you one organized place for every bill, receipt, and payment.";
  }
  if (data.topPriority === "taxes") {
    return "Tax savings are your top priority — Reclaim automatically categorizes expenses and tracks your deductions year-round.";
  }
  if (data.topPriority === "hsa_growth") {
    return "Growing your HSA is your goal — Reclaim's savings calculator and reimbursement timing tools help you maximize compound growth.";
  }
  if (data.topPriority === "organizing") {
    return "Staying organized matters most — Reclaim lets you group expenses by episode of care and find any receipt in seconds.";
  }
  return "Reclaim helps you track expenses, optimize your HSA or FSA, and keep every receipt organized in one place.";
};

export const ResultsScreen = ({ data }: ResultsScreenProps) => {
  const navigate = useNavigate();
  const [displayedSavings, setDisplayedSavings] = useState(0);
  const [email, setEmail] = useState("");
  const savings = calculateSavings(data);

  useEffect(() => {
    let start = 0;
    const end = savings.total;
    const duration = 1500;
    const increment = end / (duration / 16);

    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setDisplayedSavings(end);
        clearInterval(timer);
      } else {
        setDisplayedSavings(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [savings.total]);

  const handleEmailCapture = async () => {
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    try {
      const { error } = await supabase.functions.invoke("send-nurture-email", {
        body: {
          email,
          estimatedSavings: savings.total,
          calculatorData: data,
          sequenceDay: 0,
        },
      });

      if (error) throw error;

      sessionStorage.setItem("leadEmail", email);
      sessionStorage.setItem("calculatorData", JSON.stringify(data));
      sessionStorage.setItem("estimatedSavings", savings.total.toString());
      toast.success("Savings breakdown sent to your email!");
    } catch (error) {
      toast.error("Something went wrong. Please try again.");
    }
  };

  const personalizedMessage = getPersonalizedMessage(data);
  const accountLabel =
    data.accountType === "hsa"
      ? "HSA"
      : data.accountType === "fsa"
        ? "FSA"
        : "HSA/FSA";

  return (
    <div className="space-y-8">
      {/* Big Savings Number */}
      <div className="space-y-4 rounded-2xl bg-card p-8 shadow-lg text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full mb-2">
          <span className="text-sm font-semibold text-primary">
            Your Estimated Savings
          </span>
        </div>
        <div className="rounded-xl bg-primary/10 p-8">
          <div className="text-5xl font-bold text-primary">
            ${displayedSavings.toLocaleString()}
          </div>
          <div className="mt-2 text-lg text-muted-foreground">
            potential annual savings with {accountLabel} optimization
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{personalizedMessage}</p>
      </div>

      {/* Transparent Math Breakdown */}
      <div className="space-y-4 rounded-2xl bg-card p-8 shadow-lg">
        <h2 className="text-lg font-semibold">How we calculated this</h2>
        <div className="space-y-4">
          {/* Tax Savings */}
          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-medium">Tax Savings</span>
              <span className="font-bold text-green-600">
                ${savings.taxSavings.toLocaleString()}/year
              </span>
            </div>
            <div className="text-sm text-muted-foreground font-mono bg-muted/50 rounded px-3 py-1.5">
              {savings.formulas.taxLabel}
            </div>
            <p className="text-xs text-muted-foreground">
              {savings.formulas.taxExplanation}
            </p>
          </div>

          {/* Investment Growth */}
          {savings.investmentGrowth > 0 && (
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Projected Investment Growth</span>
                <span className="font-bold">
                  ${savings.investmentGrowth.toLocaleString()}
                </span>
              </div>
              <div className="text-sm text-muted-foreground font-mono bg-muted/50 rounded px-3 py-1.5">
                {savings.formulas.growthLabel}
              </div>
              <p className="text-xs text-muted-foreground">
                {savings.formulas.growthExplanation}
              </p>
            </div>
          )}

          {savings.investmentGrowth === 0 && data.accountType === "fsa" && (
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Investment Growth</span>
                <span className="text-muted-foreground">N/A</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {savings.formulas.growthExplanation}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CTAs */}
      <div className="space-y-3 rounded-2xl bg-card p-8 shadow-lg">
        <Button
          onClick={() => {
            sessionStorage.setItem("calculatorData", JSON.stringify(data));
            sessionStorage.setItem(
              "estimatedSavings",
              savings.total.toString(),
            );
            navigate("/auth");
          }}
          size="lg"
          className="w-full"
        >
          Start Free with Reclaim
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="lg" className="w-full">
              <Mail className="mr-2 h-4 w-4" />
              Email Me This Breakdown
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Get Your Savings Breakdown</DialogTitle>
              <DialogDescription>
                We'll send a detailed breakdown of your $
                {savings.total.toLocaleString()} estimated savings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button onClick={handleEmailCapture} className="w-full">
                Send Breakdown
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <p className="text-center text-xs text-muted-foreground">
          Free forever to start — no credit card required
        </p>
      </div>
    </div>
  );
};
