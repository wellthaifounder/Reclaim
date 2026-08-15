import { Camera, FolderOpen, Wallet, TrendingUp } from "lucide-react";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

export const HowItWorks = () => {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation({
    threshold: 0.3,
  });
  const { ref: stepsRef, isVisible: stepsVisible } = useScrollAnimation({
    threshold: 0.1,
  });

  return (
    <section id="how-it-works" className="py-20 lg:py-32 bg-gradient-soft">
      <div className="container mx-auto px-4">
        <div
          ref={headerRef}
          className={`mx-auto max-w-3xl text-center mb-16 scroll-fade-in ${headerVisible ? "visible" : ""}`}
        >
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl lg:text-5xl">
            How Reclaim Works
          </h2>
          <p className="text-lg text-muted-foreground sm:text-xl">
            Four steps to take control of your healthcare expenses and maximize
            your savings
          </p>
        </div>

        <div
          ref={stepsRef}
          className={`mx-auto max-w-3xl scroll-fade-in ${stepsVisible ? "visible" : ""}`}
        >
          {/* Step 1 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              1
            </div>
            <div className="pb-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Camera className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-lg font-semibold">
                Upload Bills & Receipts
              </h4>
              <p className="text-sm text-muted-foreground">
                Snap a photo or upload a file. Amounts, vendors, dates, and
                categories are extracted automatically.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              2
            </div>
            <div className="pb-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-lg font-semibold">
                Organize into Collections
              </h4>
              <p className="text-sm text-muted-foreground">
                Group related expenses by episode of care — a surgery, an
                ongoing treatment, or a single provider visit. Track what you
                owe at a glance.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              3
            </div>
            <div className="pb-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-lg font-semibold">
                Connect Your HSA/FSA
              </h4>
              <p className="text-sm text-muted-foreground">
                Link your accounts securely via Plaid. Reclaim automatically
                detects which expenses are HSA-eligible and tracks your
                claimable balance.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="relative pl-8">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              4
            </div>
            <div>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-lg font-semibold">Optimize & Save</h4>
              <p className="text-sm text-muted-foreground">
                Use the savings calculator to model reimbursement timing. Track
                your tax savings, and let your HSA grow tax-free until you're
                ready to reimburse.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mx-auto max-w-2xl text-center mt-16 p-8 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
          <h3 className="text-2xl font-bold mb-3">
            Start tracking your healthcare expenses
          </h3>
          <p className="text-muted-foreground mb-6">
            Free to get started. Connect your HSA or FSA whenever you're ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => (window.location.href = "/auth")}
              className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              Get Started Free
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("pricing")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="px-6 py-3 rounded-lg bg-background border border-border font-medium hover:bg-accent transition-colors"
            >
              View Pricing
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
