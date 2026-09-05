import { Landmark, FileText } from "lucide-react";
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
            From a bank transaction to an IRS-ready reimbursement, in three
            steps
          </p>
        </div>

        <div
          ref={stepsRef}
          className={`mx-auto max-w-3xl scroll-fade-in ${stepsVisible ? "visible" : ""}`}
        >
          {/* Connect isn't part of the three-step spine -- it's the one-time
              setup that feeds it (the product plan calls it "Step 0" for
              exactly that reason). Shown as a lead-in card, not a numbered
              step, so 1/2/3 below line up with Categorize / Substantiate /
              Reimburse -- the spine as actually settled. */}
          <div className="mb-10 flex items-start gap-4 rounded-xl border border-border/50 bg-card/50 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Landmark className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">First, connect your bank</p>
              <p className="text-sm text-muted-foreground">
                Link your bank, credit cards, and HSA through Plaid. Reclaim
                scans up to two years of transactions and shows you what it
                found — no manual upload required.
              </p>
            </div>
          </div>

          {/* This section used to sit next to a separate "What Reclaim Does"
              grid (Features.tsx) that described the same product a second
              time in a different shape -- three rounds of blind design
              review flagged the two as redundant. Its non-redundant
              specifics (the three eligibility checks, what's actually in
              the claim packet, organized records) are folded into the
              steps below instead of repeated in a second section. Each
              step also dropped its separate icon-in-a-circle graphic --
              the numbered badge already marks the sequence, and a second
              decorative circle right next to it was exactly the kind of
              template-filler pattern recent reviews called out. */}

          {/* Step 1 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              1
            </div>
            <div className="pb-8">
              <h4 className="mb-2 text-lg font-semibold">Categorize</h4>
              <p className="text-sm text-muted-foreground">
                We flag the transactions that look medical. You confirm each one
                — everything else stays out of your review feed automatically.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              2
            </div>
            <div className="pb-8">
              <h4 className="mb-2 text-lg font-semibold">Substantiate</h4>
              <p className="text-sm text-muted-foreground">
                Attach the bill and confirm who it was for. We check three
                things automatically — timing against your HSA's start date, who
                it's for, and whether it qualifies under IRS Publication 502 —
                before you ever submit a claim.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative pl-8 border-l-2 border-primary/30">
            <div className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              3
            </div>
            <div className="pb-8">
              <h4 className="mb-2 text-lg font-semibold">
                Reimburse — or shoebox it
              </h4>
              <p className="text-sm text-muted-foreground">
                Submit a request whenever you're ready: one packet with every
                expense's IRS Publication 502 basis, confirmation date, and
                supporting documents, ready for your HSA. Or leave it
                substantiated and banked, and let the account grow tax-free
                until you decide to claim it.
              </p>
            </div>
          </div>

          {/* Organize -- ongoing, not a step in the sequence, so it closes
              the list the same way Connect opens it: a bookend card, not a
              numbered entry. */}
          <div className="mt-2 flex items-start gap-4 rounded-xl border border-border/50 bg-card/50 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Everything stays organized
              </p>
              <p className="text-sm text-muted-foreground">
                Every bill, receipt, and payment lands in one searchable place.
                Filter by patient, category, date, or tax year — find what you
                need without digging.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
