import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { analytics } from "@/lib/analytics";

export const CTA = () => {
  const navigate = useNavigate();
  const { ref: ctaRef, isVisible: ctaVisible } = useScrollAnimation({
    threshold: 0.3,
  });

  const handleCTAClick = () => {
    analytics.ctaClick("get_started_free", "final_cta");
    navigate("/auth?signup=1");
  };

  return (
    <section className="py-12 sm:py-16 lg:py-24 xl:py-32">
      <div className="container mx-auto px-4 sm:px-6">
        <div
          ref={ctaRef}
          className={`mx-auto max-w-4xl overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-hero p-6 sm:p-8 lg:p-12 xl:p-16 text-center shadow-2xl scroll-scale-in ${ctaVisible ? "visible" : ""}`}
        >
          <h2 className="mb-3 sm:mb-4 text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-primary-foreground">
            Connect Your Bank to See What You're Owed
          </h2>
          <p className="mb-6 sm:mb-8 text-sm sm:text-base lg:text-lg xl:text-xl text-primary-foreground px-4 sm:px-0">
            Takes about a minute. No commitment, no credit card.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:gap-4">
            <Button
              size="lg"
              className="w-full sm:w-auto group bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg hover:shadow-xl transition-all text-sm sm:text-base"
              onClick={handleCTAClick}
            >
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>

          {/* Was text-white/70 and text-white/60 -- measured 3.6:1 and 3.1:1
              at the darkest point of the (now-darkened) gradient, below the
              4.5:1 floor. /90 clears it everywhere along the gradient. Also
              was two separate lines; one reads calmer than a stacked pair. */}
          <p className="mt-4 sm:mt-6 text-xs sm:text-sm text-primary-foreground/90">
            Free plan, no credit card. Paid plans include a 14-day trial and a
            30-day money-back guarantee.
          </p>
        </div>
      </div>
    </section>
  );
};
