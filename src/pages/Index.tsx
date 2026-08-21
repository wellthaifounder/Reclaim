import { useEffect } from "react";
import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
// Testimonials removed 2026-08-20 with the reviews tables. It read featured
// user reviews and returned null when there were none -- which was always,
// since nothing ever wrote one.
import { Pricing } from "@/components/Pricing";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";
import { SkipLink } from "@/components/SkipLink";
import { SEOHead } from "@/components/SEOHead";
import { analytics } from "@/lib/analytics";

const Index = () => {
  useEffect(() => {
    analytics.pageView("landing");
  }, []);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <SEOHead />
      <SkipLink />
      <Navigation />
      <main id="main-content">
        <Hero />
        <Features />
        <HowItWorks />

        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
