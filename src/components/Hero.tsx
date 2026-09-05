import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { analytics } from "@/lib/analytics";

export const Hero = () => {
  const navigate = useNavigate();
  const { ref: heroRef, isVisible: heroVisible } = useScrollAnimation({
    threshold: 0.2,
  });

  // This hero used to offer two buttons -- "See How Much You Could Save" and
  // "Start Free" -- that both called navigate("/auth?signup=1"). Same
  // destination, different copy, so the first button's promise ("see how
  // much") was never kept: clicking it went straight to sign-up with no
  // calculator in between. Collapsed to the one honest action, and labeled
  // to match the CTA everywhere else on the page (was "Start Free" here,
  // "Start Free Today" in the closing section -- see CTA.tsx).
  const handleAuthClick = () => {
    analytics.ctaClick("start_free", "hero");
    navigate("/auth?signup=1");
  };

  return (
    <section
      className="relative overflow-x-hidden bg-gradient-hero py-16 sm:py-20 lg:py-28 xl:py-36"
      aria-labelledby="hero-heading"
    >
      <div
        className="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]"
        aria-hidden="true"
      />

      <div className="container relative mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-8 sm:space-y-10">
          {/* Main headline. This hero used to also carry a 4-card teaser of
              Connect/Categorize/Substantiate/Reimburse -- but Features.tsx
              (the "what Reclaim does" grid) and HowItWorks.tsx (the
              Categorize/Substantiate/Reimburse spine, with Connect as its
              lead-in) already explain the same ideas in full below. A third,
              shorter retelling here didn't add information, it just made
              the page feel assembled rather than written -- three
              independent design reviews flagged the repetition. The
              headline and one clear action are enough. */}
          <div
            ref={heroRef}
            className={`text-center space-y-4 sm:space-y-6 scroll-fade-in ${heroVisible ? "visible" : ""}`}
          >
            <h1
              id="hero-heading"
              className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl lg:text-5xl xl:text-6xl leading-tight px-4 sm:px-0"
            >
              You Already Paid These Bills.
              {/* Gold-on-teal here previously measured 1.2:1 -- below even
                  the large-text accessibility floor of 3:1. Emphasis now
                  comes from the darkened background + full-opacity
                  foreground token, not from a second hue. */}
              <span className="block text-primary-foreground mt-2">
                Get the Money Back.
              </span>
            </h1>

            <p className="text-base sm:text-lg lg:text-xl text-primary-foreground leading-relaxed max-w-2xl mx-auto px-4 sm:px-6">
              Connect your bank and Reclaim finds what you already paid for
              care, checks it against IRS rules, and builds the paperwork to
              claim it from your HSA.
            </p>
          </div>

          {/* CTA -- one button, one destination, one label (matches
              CTA.tsx's closing button). This used to be two buttons in the
              hero alone; see the note on handleAuthClick above. */}
          <div
            className="flex justify-center pt-2 px-4 sm:px-0"
            role="group"
            aria-label="Call to action"
          >
            <Button
              size="lg"
              className="w-full sm:w-auto group bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg hover:shadow-xl transition-all text-sm sm:text-base"
              onClick={handleAuthClick}
              aria-label="Start using Reclaim for free"
            >
              Get Started Free
              <ArrowRight
                className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Button>
          </div>

          {/* Was a 3-badge row asserting "Bank-Level Security / HIPAA
              Compliant / 256-bit Encryption" -- unverifiable adjectives, and
              flagged by every design review of this page as the exact
              pattern that reads as compensating for trust rather than
              earning it. One concrete, checkable sentence instead. */}
          <p className="flex items-center justify-center gap-2 pt-4 text-xs sm:text-sm text-primary-foreground/90 border-t border-white/10">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            Bank connections are read-only via Plaid — your login never touches
            our servers, and we never move your money.
          </p>
        </div>
      </div>
    </section>
  );
};
