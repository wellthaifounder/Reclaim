import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle2,
  Sparkles,
  FileText,
  TrendingUp,
  Shield,
  ArrowLeft,
} from "lucide-react";
import { CountdownTimer } from "./CountdownTimer";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmbeddedCheckout } from "@/components/stripe/EmbeddedCheckout";

interface TripwireOfferProps {
  estimatedSavings: number;
  calculatorData?: any;
  onPurchaseComplete?: () => void;
}

export const TripwireOffer = ({
  estimatedSavings,
  calculatorData,
  onPurchaseComplete,
}: TripwireOfferProps) => {
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  const handlePurchase = async () => {
    setIsProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "create-tripwire-checkout",
        {
          body: {
            estimatedSavings,
            calculatorData,
          },
        },
      );

      if (error) {
        throw error;
      }

      if (data?.clientSecret) {
        sessionStorage.setItem(
          "stripe_tripwire_client_secret",
          data.clientSecret,
        );

        // Clear calculator data since they're purchasing (won't need to see tripwire again)
        sessionStorage.removeItem("estimatedSavings");
        sessionStorage.removeItem("calculatorData");

        navigate("/checkout");
        return;
      }

      throw new Error("No client secret returned");
    } catch (error) {
      toast.error(
        `Error: ${error instanceof Error ? error.message : "Something went wrong"}`,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (showCheckout && clientSecret) {
    return (
      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={() => setShowCheckout(false)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Offer
        </Button>
        <EmbeddedCheckout
          clientSecret={clientSecret}
          onComplete={onPurchaseComplete}
        />
      </div>
    );
  }

  return (
    <Card className="border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10 p-6 shadow-xl">
      <div className="space-y-6">
        {/* Urgency Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold text-primary">
              LIMITED TIME OFFER
            </span>
          </div>
          <CountdownTimer minutes={15} />
        </div>

        {/* Offer Title */}
        <div className="space-y-2">
          <h3 className="text-2xl font-bold">
            Get Your Complete HSA Maximizer Report
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-primary">$17</span>
            <span className="text-lg text-muted-foreground line-through">
              $199
            </span>
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">
              91% OFF
            </span>
          </div>
        </div>

        {/* What's Included */}
        <div className="space-y-3">
          <p className="font-semibold">Here's what you'll get instantly:</p>
          <div className="grid gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Personalized 15-Page PDF Report</p>
                <p className="text-sm text-muted-foreground">
                  Based on your ${estimatedSavings.toLocaleString()}/year
                  savings potential
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Best Credit Cards for Healthcare</p>
                <p className="text-sm text-muted-foreground">
                  Curated list of cards with best HSA rewards
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Month-by-Month Action Plan</p>
                <p className="text-sm text-muted-foreground">
                  Exactly what to do each month to maximize savings
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Tax Optimization Checklist</p>
                <p className="text-sm text-muted-foreground">
                  Don't miss any deductions this tax season
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bonus */}
        <div className="rounded-lg border-2 border-dashed border-primary bg-background p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary p-2">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-semibold">BONUS: 14-Day Plus Trial FREE</p>
              <p className="text-sm text-muted-foreground">
                Try all premium features risk-free ($19 value)
              </p>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <Button
          size="lg"
          className="w-full text-lg"
          onClick={handlePurchase}
          disabled={isProcessing}
        >
          {isProcessing
            ? "Loading Secure Checkout..."
            : "Get Instant Access - Only $17"}
        </Button>

        {/* Trust Badges */}
        <div className="grid grid-cols-3 gap-4 border-t pt-4 text-center">
          <div className="space-y-1">
            <Shield className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Secure Payment</p>
          </div>
          <div className="space-y-1">
            <FileText className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Instant Download</p>
          </div>
          <div className="space-y-1">
            <TrendingUp className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Money-Back</p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Join 2,847 smart savers who've already claimed this offer
        </p>
      </div>
    </Card>
  );
};
