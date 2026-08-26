import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useNavigate } from "react-router-dom";
import { ROICalculator } from "@/components/pricing/ROICalculator";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { analytics } from "@/lib/analytics";

const pricingTiers = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    description: "Perfect for testing the waters with basic tracking",
    features: [
      { text: "Up to 50 bills/month", included: true },
      { text: "Manual expense entry", included: true },
      { text: "Basic receipt storage (50 MB)", included: true },
      { text: "Smart expense categorization", included: true },
      { text: "Simple reimbursement PDFs", included: true },
      { text: "Receipt OCR automation", included: false },
      { text: "Bank account connections", included: false },
      { text: "Advanced analytics", included: false },
    ],
    cta: "Start Free",
    popular: false,
  },
  {
    name: "Plus",
    price: "$19",
    period: "per month",
    description: "For anyone serious about saving on healthcare costs",
    annualPrice: "$15/mo",
    annualSavings: "Save $48/year with annual billing",
    features: [
      { text: "All Starter features", included: true },
      { text: "Unlimited bills/month", included: true },
      { text: "Receipt OCR automation", included: true },
      { text: "Bank/card integration via Plaid", included: true },
      { text: "Pre-Purchase Decision Tool", included: true },
      { text: "Link transactions to bills", included: true },
      { text: "Multiple payment method tracking", included: true },
      { text: "Rewards optimization alerts", included: true },
      { text: "Advanced analytics & reports", included: true },
      { text: "Document storage (500 MB)", included: true },
      { text: "HSA eligibility detection", included: true },
      { text: "AI-Powered Insights", included: false },
      { text: "Investment tracking", included: false },
    ],
    cta: "Start 14-Day Trial",
    popular: true,
  },
  {
    name: "Premium",
    price: "$49",
    period: "per month",
    description: "Maximum automation for high healthcare spenders",
    annualPrice: "$39/mo",
    annualSavings: "Save $120/year with annual billing",
    features: [
      { text: "All Plus features", included: true },
      { text: "AI-Powered Insights & forecasting", included: true },
      { text: "HSA Investment Vault Tracker", included: true },
      { text: "Tax optimization reports", included: true },
      { text: "Multi-year expense tracking", included: true },
      { text: "Export analytics to PDF/CSV", included: true },
      { text: "Priority support (1hr response)", included: true },
      { text: "Advanced payment strategy modeling", included: true },
      { text: "Unlimited document storage", included: true },
      { text: "Family expense consolidation", included: true },
    ],
    cta: "Start 14-Day Trial",
    popular: false,
  },
];

export const Pricing = () => {
  const { createCheckoutSession } = useSubscription();
  const navigate = useNavigate();
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation({
    threshold: 0.3,
  });
  const { ref: cardsRef, isVisible: cardsVisible } = useScrollAnimation({
    threshold: 0.1,
  });
  const { ref: faqRef, isVisible: faqVisible } = useScrollAnimation({
    threshold: 0.1,
  });

  const handleCTA = (tierName: string) => {
    analytics.pricingView(tierName);
    if (tierName === "Starter") {
      navigate("/auth?signup=1");
    } else if (tierName === "Plus") {
      createCheckoutSession("plus");
    } else if (tierName === "Premium") {
      createCheckoutSession("premium");
    }
  };

  return (
    <section id="pricing" className="py-12 sm:py-16 lg:py-24 xl:py-32">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Header */}
        <div
          ref={headerRef}
          className={`mx-auto max-w-3xl text-center mb-8 sm:mb-12 scroll-fade-in ${headerVisible ? "visible" : ""}`}
        >
          <h2 className="mb-4 text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold">
            Pricing That Pays for Itself
          </h2>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-4 sm:px-0">
            Most users save 10-20x their subscription cost. Start free, upgrade
            when ready.
          </p>
        </div>

        {/* ROI Calculator */}
        <ROICalculator />

        {/* Pricing Cards */}
        <div
          ref={cardsRef}
          className={`mx-auto mt-12 sm:mt-16 grid max-w-6xl gap-6 sm:gap-8 grid-cols-1 md:grid-cols-3 scroll-fade-in ${cardsVisible ? "visible" : ""}`}
        >
          {pricingTiers.map((tier) => (
            <Card
              key={tier.name}
              className={`relative flex flex-col ${
                tier.popular
                  ? "border-primary shadow-lg ring-2 ring-primary/20"
                  : ""
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-primary px-4 py-1 text-sm font-medium text-primary-foreground">
                    Most Popular
                  </span>
                </div>
              )}

              <CardHeader>
                <CardTitle className="text-2xl">{tier.name}</CardTitle>
                <CardDescription className="min-h-12">
                  {tier.description}
                </CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{tier.price}</span>
                  {tier.period && (
                    <span className="text-muted-foreground">
                      {" "}
                      /{tier.period}
                    </span>
                  )}
                  {tier.annualPrice && (
                    <p className="mt-2 text-sm font-medium text-primary">
                      or {tier.annualPrice} billed annually
                    </p>
                  )}
                  {tier.annualSavings && (
                    <p className="text-xs text-muted-foreground">
                      {tier.annualSavings}
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col">
                <Button
                  className="mb-6 w-full"
                  variant={tier.popular ? "default" : "outline"}
                  size="lg"
                  onClick={() => handleCTA(tier.name)}
                >
                  {tier.cta}
                </Button>

                <ul className="space-y-3 text-sm">
                  {tier.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check className="h-5 w-5 shrink-0 text-primary" />
                      ) : (
                        <X className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                      )}
                      <span
                        className={
                          feature.included ? "" : "text-muted-foreground"
                        }
                      >
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* FAQ Section */}
        <div
          ref={faqRef}
          className={`mx-auto mt-24 max-w-3xl scroll-fade-in delay-200 ${faqVisible ? "visible" : ""}`}
        >
          <h3 className="mb-8 text-center text-2xl font-bold">
            Frequently Asked Questions
          </h3>
          <div className="space-y-6">
            <div>
              <h4 className="mb-2 font-semibold">
                Do I need an HSA to use Reclaim?
              </h4>
              <p className="text-muted-foreground">
                <strong>No!</strong> Reclaim helps anyone save on healthcare
                costs through smarter payment strategies, receipt organization,
                and tax-deductible expense tracking. If you <em>do</em> have an
                HSA, you'll unlock bonus features like investment tracking and
                strategic reimbursement timing.
              </p>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">
                Can I switch plans anytime?
              </h4>
              <p className="text-muted-foreground">
                Yes! Upgrade or downgrade anytime. When upgrading, you'll be
                charged a prorated amount. When downgrading, you'll receive
                credit for your next billing cycle.
              </p>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">
                What happens if I exceed my plan limits?
              </h4>
              <p className="text-muted-foreground">
                On the free plan, you'll be prompted to upgrade when you hit 50
                bills. We'll never charge you without permission or delete your
                data.
              </p>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">
                Is my financial data secure?
              </h4>
              <p className="text-muted-foreground">
                Absolutely. We use bank-level encryption, never store card
                numbers, and are fully compliant with healthcare data
                regulations (HIPAA).
              </p>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">
                Do you offer annual billing?
              </h4>
              <p className="text-muted-foreground">
                Yes! Save 20% with annual billing on both Plus ($180/year vs
                $228) and Premium ($468/year vs $588).
              </p>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">
                What payment methods do you accept?
              </h4>
              <p className="text-muted-foreground">
                We accept all major credit cards, debit cards, and digital
                wallets. Payments are processed securely through Stripe.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
