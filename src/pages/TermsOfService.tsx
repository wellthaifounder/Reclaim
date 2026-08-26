import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <article className="prose prose-slate max-w-none">
          <h1 className="mb-2 text-3xl font-bold">Terms of Service</h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Effective Date: June 14, 2026 &middot; Last Updated: June 14, 2026
          </p>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              1. Agreement to Terms
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              These Terms of Service ("Terms") govern your access to and use of
              Reclaim's web and mobile applications (the "Service"). By creating
              an account or using the Service, you agree to be bound by these
              Terms and by our{" "}
              <a href="/privacy" className="text-primary underline">
                Privacy Policy
              </a>
              . If you do not agree, do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">2. What Reclaim Is</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Reclaim helps you identify healthcare expenses that may be
              eligible for reimbursement from a Health Savings Account (HSA) or
              Flexible Spending Account (FSA), organize supporting
              documentation, and generate substantiation records. Reclaim is a
              recordkeeping and organizational tool. It is{" "}
              <strong>
                not a tax advisor, financial advisor, accountant, HSA custodian,
                or healthcare provider
              </strong>
              , and nothing in the Service constitutes tax, legal, financial, or
              medical advice.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              3. Eligibility & Accounts
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You must be at least 18 years old and able to form a binding
              contract to use the Service. You are responsible for the accuracy
              of the information you provide, for maintaining the
              confidentiality of your credentials, and for all activity that
              occurs under your account. Notify us immediately of any
              unauthorized use.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              4. Not Tax or Financial Advice
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Eligibility determinations, IRS Publication 502 classifications,
              and substantiation records produced by the Service are estimates
              and aids, not guarantees. Tax rules change and apply differently
              to each person. You are solely responsible for confirming that an
              expense qualifies, for the timing and substantiation of any
              HSA/FSA reimbursement you take, and for your own tax filings.
              Consult a qualified professional before acting. You assume all
              responsibility for reimbursements you choose to make.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              5. Connected Accounts (Plaid)
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              If you connect a financial institution through Plaid, you
              authorize us to access transaction and account data as described
              in our Privacy Policy. You may disconnect a connected account at
              any time. We do not receive or store your bank login credentials.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              6. Subscriptions & Billing
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Paid tiers are billed in advance on a recurring basis through
              Stripe and renew automatically until cancelled. You may cancel at
              any time; cancellation takes effect at the end of the current
              billing period. Except where required by law, fees already paid
              are non-refundable. We may change pricing with prior notice.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">7. Acceptable Use</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You agree not to misuse the Service, including by:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li>Uploading data you do not have the right to provide</li>
              <li>
                Attempting to access other users' data or circumvent security
                controls
              </li>
              <li>Reverse engineering, scraping, or overloading the Service</li>
              <li>Using the Service for any unlawful or fraudulent purpose</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              8. Your Content & License
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You retain ownership of the documents and data you upload. You
              grant us a limited license to store, process, and display that
              content solely to operate and provide the Service to you. We
              handle health- related information as described in our Privacy
              Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              9. Disclaimers & Limitation of Liability
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The Service is provided "as is" and "as available" without
              warranties of any kind, whether express or implied. To the maximum
              extent permitted by law, Reclaim will not be liable for any
              indirect, incidental, special, consequential, or punitive damages,
              or for any loss arising from reimbursement decisions, tax
              outcomes, or reliance on classifications or records produced by
              the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">10. Termination</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You may stop using the Service and delete your account at any
              time. We may suspend or terminate access if you violate these
              Terms or to protect the Service or other users. You may export or
              request deletion of your data as described in our Privacy Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">11. Changes to Terms</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We may update these Terms from time to time. Material changes will
              be communicated through the Service or by email. Your continued
              use after changes take effect constitutes acceptance of the
              revised Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">12. Contact Us</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Questions about these Terms? Contact us at:
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              <a
                href="mailto:wellth.ai.founder@gmail.com"
                className="text-primary underline"
              >
                wellth.ai.founder@gmail.com
              </a>
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default TermsOfService;
