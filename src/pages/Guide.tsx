import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrencyWhole } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Inbox,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  PiggyBank,
  ArrowRight,
  Lightbulb,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { HSA_LIMITS_CURRENT, CURRENT_TAX_YEAR } from "@/lib/regulatoryLimits";

const Guide = () => {
  const navigate = useNavigate();

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-10">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-primary/10 mb-2">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">
            Maximize Your Healthcare Savings
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Reclaim helps you track every medical expense so you can claim HSA
            reimbursements on your schedule — now or decades from now.
          </p>
        </div>

        {/* Section 1: HSA Strategy */}
        <section id="hsa-strategy" className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <PiggyBank className="h-5 w-5 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Why HSAs Are Powerful</h2>
          </div>

          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground mb-6">
                A Health Savings Account (HSA) is the only account in the US tax
                code with a <strong>triple tax advantage</strong>:
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <h3 className="font-semibold">Tax-Free In</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Contributions are pre-tax (payroll) or tax-deductible
                    (direct). In {CURRENT_TAX_YEAR}, you can contribute up to{" "}
                    <strong>
                      {formatCurrencyWhole(HSA_LIMITS_CURRENT.selfOnly)}
                    </strong>{" "}
                    (self-only) or{" "}
                    <strong>
                      {formatCurrencyWhole(HSA_LIMITS_CURRENT.family)}
                    </strong>{" "}
                    (family), plus{" "}
                    {formatCurrencyWhole(HSA_LIMITS_CURRENT.catchUp)} catch-up
                    if you're 55+.
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600 shrink-0" />
                    <h3 className="font-semibold">Tax-Free Growth</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Unlike an FSA, your HSA balance carries over year to year.
                    You can invest the funds and all growth — interest,
                    dividends, capital gains — is completely tax-free.
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-purple-600 shrink-0" />
                    <h3 className="font-semibold">Tax-Free Out</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Withdrawals for qualified medical expenses are tax-free.
                    After age 65, non-medical withdrawals are taxed like
                    traditional IRA distributions (no penalty).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* The Shoebox Strategy */}
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-600" />
                The "Shoebox" Strategy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                There is <strong>no time limit</strong> on HSA reimbursements.
                As long as the expense occurred after your HSA was opened, you
                can reimburse yourself years or even decades later. This unlocks
                a powerful wealth-building strategy:
              </p>
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-sm font-bold shrink-0">
                    1
                  </span>
                  <div>
                    <p className="font-medium">
                      Pay medical expenses out-of-pocket
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Use your debit card or checking account instead of your
                      HSA card.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-sm font-bold shrink-0">
                    2
                  </span>
                  <div>
                    <p className="font-medium">
                      Save your receipts (Reclaim does this for you)
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Upload bills and receipts to build a verified paper trail
                      you can access anytime.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-sm font-bold shrink-0">
                    3
                  </span>
                  <div>
                    <p className="font-medium">Let your HSA grow tax-free</p>
                    <p className="text-sm text-muted-foreground">
                      Invest your HSA balance. At a 7% annual return, $4,300
                      grows to ~$8,500 in 10 years — all tax-free.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-sm font-bold shrink-0">
                    4
                  </span>
                  <div>
                    <p className="font-medium">
                      Reimburse yourself whenever you want
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Need cash? Generate a reimbursement claim from your saved
                      receipts. The IRS just requires that you have
                      documentation.
                    </p>
                  </div>
                </li>
              </ol>
              <div className="rounded-lg bg-amber-500/10 p-4 mt-4">
                <p className="text-sm font-medium text-amber-800">
                  Example: You pay $3,000 for dental work this year out of
                  pocket. Ten years from now, your HSA has grown. You reimburse
                  yourself the full $3,000 tax-free — and keep all the
                  investment gains too.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Section 2: How Reclaim Works */}
        <section id="app-workflow" className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <ArrowRight className="h-5 w-5 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold">How Reclaim Works</h2>
          </div>

          <p className="text-muted-foreground">
            Reclaim turns your medical expenses into a searchable, organized
            archive — so when you're ready to reimburse, you have everything you
            need in one click. Here are the four steps:
          </p>

          <div className="space-y-4">
            {/* Step 1 */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-500/10 shrink-0">
                    <Upload className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">
                      Step 1: Upload Bills
                    </h3>
                    <p className="text-muted-foreground">
                      Scan or photograph medical bills and receipts. Reclaim
                      uses AI to extract the vendor, date, amount, and category
                      automatically. You can also connect your bank via Plaid to
                      auto-import transactions.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/expenses/new")}
                    >
                      Upload a bill
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-orange-500/10 shrink-0">
                    <Inbox className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">
                      Step 2: Triage Your Inbox
                    </h3>
                    <p className="text-muted-foreground">
                      When transactions arrive from your bank, Reclaim asks you
                      one question: <em>is this medical?</em> Mark transactions
                      as medical or not-medical to build an accurate record. The
                      system learns your preferences over time — known vendors
                      are auto-classified on future imports.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/transactions")}
                    >
                      Open Transactions
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-500/10 shrink-0">
                    <ShieldCheck className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">
                      Step 3: Claim HSA Reimbursement
                    </h3>
                    <p className="text-muted-foreground">
                      When you're ready — whether that's tomorrow or ten years
                      from now — generate a reimbursement PDF with one click.
                      The claim includes all the documentation your HSA provider
                      needs: vendor, dates, amounts, and payment proof. Submit
                      it to your HSA administrator and get your money back
                      tax-free.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/substantiation")}
                    >
                      View HSA Claims
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Section 3: Tips */}
        <section id="tips" className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Lightbulb className="h-5 w-5 text-purple-600" />
            </div>
            <h2 className="text-2xl font-bold">Tips for Maximum Savings</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h3 className="font-semibold">Max out contributions</h3>
                <p className="text-sm text-muted-foreground">
                  Contribute the full{" "}
                  {formatCurrencyWhole(HSA_LIMITS_CURRENT.selfOnly)} (self-only)
                  or {formatCurrencyWhole(HSA_LIMITS_CURRENT.family)} (family)
                  each year. Every dollar you contribute reduces your taxable
                  income.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h3 className="font-semibold">Invest your balance</h3>
                <p className="text-sm text-muted-foreground">
                  Most HSA providers let you invest once your balance exceeds a
                  threshold (often $1,000-$2,000). Low-cost index funds work
                  well for long-term growth.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h3 className="font-semibold">Upload every receipt</h3>
                <p className="text-sm text-muted-foreground">
                  Even small expenses add up. Upload copay receipts,
                  prescription costs, and dental/vision bills. They're all
                  reimbursable — and having them in Reclaim means you'll never
                  lose them.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h3 className="font-semibold">Delay reimbursements</h3>
                <p className="text-sm text-muted-foreground">
                  If you can afford to pay out-of-pocket, let your HSA balance
                  grow. You can always reimburse yourself later for past
                  expenses — there's no deadline.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center py-6">
          <Button size="lg" onClick={() => navigate("/transactions")}>
            Get Started with Your Transactions
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </AuthenticatedLayout>
  );
};

export default Guide;
