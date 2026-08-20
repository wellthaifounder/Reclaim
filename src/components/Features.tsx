import {
  Receipt,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  PiggyBank,
  FileText,
} from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const features = [
  {
    icon: Receipt,
    title: "Smart Expense Tracking",
    description:
      "Upload bills and receipts — amounts, vendors, dates, and categories are extracted automatically so you never have to enter data by hand.",
  },
  {
    icon: Landmark,
    title: "Connected to Your Bank",
    description:
      "Link your accounts and Reclaim finds the medical spending automatically — including what you paid out of pocket after insurance, which a receipt alone never shows.",
  },
  {
    icon: ShieldCheck,
    title: "Audit-Ready Claim Packets",
    description:
      "One file for your custodian: every expense with its IRS Publication 502 basis, the date you confirmed it, and all supporting documents attached.",
  },
  {
    icon: CheckCircle2,
    title: "Tax Deduction Tracking",
    description:
      "Every medical expense is automatically categorized for tax purposes. Export IRS-compliant reports in seconds.",
  },
  {
    icon: PiggyBank,
    title: "HSA/FSA Optimization",
    description:
      "Strategic reimbursement timing, claimable balance tracking, and investment vault monitoring for your tax-advantaged accounts.",
  },
  {
    icon: FileText,
    title: "Organized Records",
    description:
      "All your bills, receipts, and payments in one searchable place. Filter by patient, category, date, or tax year.",
  },
];

export const Features = () => {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation({
    threshold: 0.3,
  });
  const { ref: featuresRef, isVisible: featuresVisible } = useScrollAnimation({
    threshold: 0.1,
  });

  return (
    <section
      id="features"
      className="py-12 sm:py-16 lg:py-24 xl:py-32"
      aria-labelledby="features-heading"
    >
      <div className="container mx-auto px-4 sm:px-6">
        <div
          ref={headerRef}
          className={`mx-auto mb-12 sm:mb-16 max-w-2xl text-center scroll-fade-in ${headerVisible ? "visible" : ""}`}
        >
          <h2
            id="features-heading"
            className="mb-4 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight"
          >
            Everything You Need to Take Control
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground px-4 sm:px-0">
            Track, organize, and optimize your medical expenses — with powerful
            tools built for HSA and FSA holders.
          </p>
        </div>

        <div
          ref={featuresRef}
          className={`grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 scroll-fade-in ${featuresVisible ? "visible" : ""}`}
          role="list"
          aria-label="Product features"
        >
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card
                key={index}
                className="border-border/50 transition-all hover:shadow-lg h-full"
                role="listitem"
              >
                <CardHeader className="pb-4">
                  <div
                    className="mb-3 sm:mb-4 inline-flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-primary/10"
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg sm:text-xl">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="text-sm sm:text-base">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};
