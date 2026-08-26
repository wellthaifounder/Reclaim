import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Receipt,
  FolderOpen,
  Wallet,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { analytics } from "@/lib/analytics";

export const Hero = () => {
  const navigate = useNavigate();
  const { ref: heroRef, isVisible: heroVisible } = useScrollAnimation({
    threshold: 0.2,
  });
  const { ref: painPointsRef, isVisible: painPointsVisible } =
    useScrollAnimation({ threshold: 0.1 });
  const { ref: hsaBonusRef, isVisible: hsaBonusVisible } = useScrollAnimation({
    threshold: 0.05,
    rootMargin: "50px",
  });

  // The four-step savings quiz this used to open was retired on 2026-08-20.
  // Its job was to get a visitor to an estimate and then to sign-up; the app
  // now does that with the visitor's own bank data on the historical-import
  // screen, which is a real number instead of a guessed one. Kept as its own
  // handler (rather than folded into handleAuthClick) so the two hero buttons
  // stay separable in the funnel data.
  const handleCalculatorClick = () => {
    analytics.ctaClick("calculator", "hero");
    navigate("/auth?signup=1");
  };

  const handleAuthClick = () => {
    analytics.ctaClick("start_free", "hero");
    navigate("/auth?signup=1");
  };

  return (
    <section
      className="relative overflow-x-hidden bg-gradient-hero py-12 sm:py-16 lg:py-24 xl:py-32"
      aria-labelledby="hero-heading"
    >
      <div
        className="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]"
        aria-hidden="true"
      />

      <div className="container relative mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-8 sm:space-y-12">
          {/* Main headline */}
          <div
            ref={heroRef}
            className={`text-center space-y-4 sm:space-y-6 scroll-fade-in ${heroVisible ? "visible" : ""}`}
          >
            <h1
              id="hero-heading"
              className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl xl:text-6xl leading-tight px-4 sm:px-0"
            >
              Your HSA Could Be Saving You
              <span className="block bg-gradient-to-r from-accent to-accent/80 bg-clip-text text-transparent mt-2">
                Thousands More.
              </span>
            </h1>

            <p className="text-base sm:text-lg lg:text-xl text-white/90 leading-relaxed max-w-3xl mx-auto px-4 sm:px-6">
              Track medical expenses, organize receipts, and optimize your HSA
              or FSA—all in one place.
              <span className="block mt-2 font-medium text-white">
                See exactly how much you could save with smarter reimbursement
                timing.
              </span>
            </p>
          </div>

          {/* Pain points we solve */}
          <div
            ref={painPointsRef}
            className={`grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-8 sm:mt-12 px-4 sm:px-0 scroll-fade-in ${painPointsVisible ? "visible" : ""}`}
          >
            <div className="rounded-lg bg-white/10 p-4 sm:p-6 backdrop-blur-sm border border-white/20 transition-all hover:bg-white/15">
              <Receipt
                className="h-5 w-5 text-accent mb-2"
                aria-hidden="true"
              />
              <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">
                Track Every Expense
              </h3>
              <p className="text-xs sm:text-sm text-white/80">
                Upload bills and receipts — details are extracted automatically
              </p>
            </div>
            <div className="rounded-lg bg-white/10 p-4 sm:p-6 backdrop-blur-sm border border-white/20 transition-all hover:bg-white/15">
              <FolderOpen
                className="h-5 w-5 text-accent mb-2"
                aria-hidden="true"
              />
              <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">
                Sorted Automatically
              </h3>
              <p className="text-xs sm:text-sm text-white/80">
                Bank transactions sorted into medical and not, so you only
                review what matters
              </p>
            </div>
            <div className="rounded-lg bg-white/10 p-4 sm:p-6 backdrop-blur-sm border border-white/20 transition-all hover:bg-white/15">
              <Wallet className="h-5 w-5 text-accent mb-2" aria-hidden="true" />
              <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">
                Connect Your HSA/FSA
              </h3>
              <p className="text-xs sm:text-sm text-white/80">
                Link accounts securely and auto-detect HSA-eligible expenses
              </p>
            </div>
            <div className="rounded-lg bg-white/10 p-4 sm:p-6 backdrop-blur-sm border border-white/20 transition-all hover:bg-white/15">
              <TrendingUp
                className="h-5 w-5 text-accent mb-2"
                aria-hidden="true"
              />
              <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">
                Maximize Tax Savings
              </h3>
              <p className="text-xs sm:text-sm text-white/80">
                Time your reimbursements strategically and let your HSA grow
              </p>
            </div>
          </div>

          {/* CTAs */}
          <div
            className="flex flex-col items-center justify-center gap-3 sm:gap-4 pt-4 px-4 sm:px-0"
            role="group"
            aria-label="Call to action"
          >
            <Button
              size="lg"
              className="w-full sm:w-auto group bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg hover:shadow-xl transition-all text-sm sm:text-base"
              onClick={handleCalculatorClick}
              aria-label="See how much you could save with Reclaim"
            >
              See How Much You Could Save
              <ArrowRight
                className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 text-sm sm:text-base"
              onClick={handleAuthClick}
              aria-label="Start using Reclaim for free"
            >
              Start Free
            </Button>
          </div>

          {/* Trust bar */}
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-6 text-xs sm:text-sm text-white/70 border-t border-white/10 px-4 sm:px-0">
            <div className="flex items-center gap-2">
              <svg
                className="h-3 w-3 sm:h-4 sm:w-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Bank-Level Security</span>
            </div>
            <div className="flex items-center gap-2">
              <svg
                className="h-3 w-3 sm:h-4 sm:w-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>HIPAA Compliant</span>
            </div>
            <div className="flex items-center gap-2">
              <svg
                className="h-3 w-3 sm:h-4 sm:w-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <span>256-bit Encryption</span>
            </div>
          </div>

          {/* HSA/FSA Highlights */}
          <div
            ref={hsaBonusRef}
            className={`rounded-2xl bg-white/5 p-6 sm:p-8 backdrop-blur-sm border border-white/10 mt-8 sm:mt-12 scroll-scale-in ${hsaBonusVisible ? "visible" : ""}`}
          >
            <div className="text-center mb-4">
              <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
                Built for HSA & FSA Holders
              </h3>
              <p className="text-sm sm:text-base text-white/80">
                Reclaim is designed to help you get the most from your
                tax-advantaged healthcare accounts.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 text-xs sm:text-sm text-white/90">
              <li className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-accent shrink-0" />
                <span>Automatic HSA eligibility detection</span>
              </li>
              <li className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-accent shrink-0" />
                <span>Investment vault tracking</span>
              </li>
              <li className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-accent shrink-0" />
                <span>Strategic reimbursement timing</span>
              </li>
              <li className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-accent shrink-0" />
                <span>Tax-free growth optimization</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};
