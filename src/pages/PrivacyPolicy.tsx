import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <article className="prose prose-slate max-w-none">
          <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Effective Date: April 24, 2026 &middot; Last Updated: April 24, 2026
          </p>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">1. Introduction</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Reclaim ("we," "us," or "our") provides a healthcare expense
              management platform that helps users track HSA/FSA accounts,
              categorize medical expenses, and manage reimbursements. This
              Privacy Policy explains how we collect, use, store, and protect
              your personal information when you use our web and mobile
              applications (the "Service").
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              2. Information We Collect
            </h2>
            <h3 className="mb-2 mt-4 text-base font-semibold">
              Account Information
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              When you create an account, we collect your email address, name,
              and authentication credentials. If you sign in with Google, we
              receive basic profile information from your Google account.
            </p>
            <h3 className="mb-2 mt-4 text-base font-semibold">
              Financial Information (via Plaid)
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              With your explicit consent, we use Plaid Inc. ("Plaid") to connect
              to your financial institutions. Plaid provides us with transaction
              data, account balances, and account metadata. We do not receive or
              store your bank login credentials. Plaid's own privacy practices
              are described at{" "}
              <a
                href="https://plaid.com/legal/#end-user-privacy-policy"
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                plaid.com/legal
              </a>
              .
            </p>
            <h3 className="mb-2 mt-4 text-base font-semibold">
              Health-Related Information
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              When you upload receipts, medical bills, or other documents, we
              may collect information about medical services, providers,
              diagnoses, and amounts. We treat this information as Protected
              Health Information (PHI) and apply controls consistent with HIPAA
              safeguards.
            </p>
            <h3 className="mb-2 mt-4 text-base font-semibold">
              Payment Information
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Subscription payments are processed by Stripe. We do not store
              your full payment card details on our servers. Stripe's privacy
              policy is available at stripe.com/privacy.
            </p>
            <h3 className="mb-2 mt-4 text-base font-semibold">
              Usage & Device Data
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We collect standard technical information such as browser type,
              operating system, IP address, and application usage patterns to
              operate and improve the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li>To provide, maintain, and improve the Service</li>
              <li>To categorize and analyze your healthcare expenses</li>
              <li>To identify potential HSA/FSA reimbursement opportunities</li>
              <li>To process subscription payments</li>
              <li>
                To communicate with you about your account and the Service
              </li>
              <li>To detect and prevent fraud, abuse, or security incidents</li>
              <li>To comply with legal and regulatory obligations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              4. How We Share Information
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We do not sell your personal information. We share information
              only with the following categories of service providers, each
              under a data protection agreement:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li>
                <strong>Supabase</strong> — database, authentication, and
                server-side processing
              </li>
              <li>
                <strong>Vercel</strong> — web application hosting
              </li>
              <li>
                <strong>Plaid</strong> — secure connections to financial
                institutions (with your consent)
              </li>
              <li>
                <strong>Stripe</strong> — payment processing
              </li>
              <li>
                <strong>Google (Gemini via Vertex AI, under a BAA)</strong> —
                AI-assisted receipt processing and expense classification on
                Google Cloud's HIPAA-covered Vertex AI platform
              </li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We may also disclose information if required by law, to enforce
              our Terms of Service, or to protect the rights, safety, or
              property of Reclaim or others.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">5. Data Security</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We apply administrative, technical, and physical safeguards
              designed to protect your information, including:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li>TLS 1.2+ encryption for all data in transit</li>
              <li>AES-256-GCM encryption of financial access tokens at rest</li>
              <li>Row-level security enforcing per-user data isolation</li>
              <li>JWT-based authentication on all API requests</li>
              <li>
                PHI-safe logging practices that prevent sensitive data from
                being recorded
              </li>
              <li>Regular credential rotation and access reviews</li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              No system is 100% secure. We encourage you to use a strong, unique
              password and to notify us immediately if you suspect unauthorized
              access to your account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">6. Data Retention</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We retain your information for as long as your account is active
              or as needed to provide the Service. You may request deletion of
              your account and associated data at any time by contacting us at
              the address below. Certain information may be retained to comply
              with legal obligations, resolve disputes, or enforce our
              agreements.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">7. Your Rights</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Disconnect any connected financial accounts at any time</li>
              <li>
                Withdraw consent for data processing where consent is the basis
              </li>
              <li>Opt out of marketing communications</li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              To exercise these rights, contact us at the email address below.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              8. Children's Privacy
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The Service is not directed to children under 13, and we do not
              knowingly collect personal information from children under 13. If
              you believe a child has provided us information, please contact us
              so we can delete it.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">
              9. Changes to This Policy
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We may update this Privacy Policy from time to time. Material
              changes will be communicated through the Service or by email. The
              "Last Updated" date at the top of this page indicates when the
              policy was most recently revised.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">10. Contact Us</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              If you have questions about this Privacy Policy or our data
              practices, contact us at:
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

export default PrivacyPolicy;
