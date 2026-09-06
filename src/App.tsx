import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { HSAProvider } from "@/contexts/HSAContext";
// OnboardingProvider removed 2026-08-23. It kept setup state in localStorage,
// which is per-browser: the same person setting up on a laptop was treated as
// brand new when they signed in on a phone. Setup state now lives on the
// profile row — see useOnboardingStatus.
import { DashboardLayoutProvider } from "@/contexts/DashboardLayoutContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { CookieConsent } from "@/components/CookieConsent";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";

// Critical pages - load immediately
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";

// Lazy load non-critical pages for better performance
const BillDetail = lazy(() => import("./pages/BillDetail"));
// Serves /expenses. Named for the transactions it categorises; it also hosts
// the expense list as its "To claim" tab, so Bills is no longer routed
// directly -- Transactions imports it.
const Transactions = lazy(() => import("./pages/Transactions"));
const BankAccounts = lazy(() => import("./pages/BankAccounts"));
const HistoricalImport = lazy(() => import("./pages/HistoricalImport"));
const Welcome = lazy(() => import("./pages/Welcome"));
const ExpenseEntry = lazy(() => import("./pages/ExpenseEntry"));
const Substantiate = lazy(() => import("./pages/Substantiate"));
const Substantiation = lazy(() => import("./pages/Substantiation"));
const Documents = lazy(() => import("./pages/Documents"));
const Settings = lazy(() => import("./pages/Settings"));
const Install = lazy(() => import("./pages/Install"));
// /checkout removed 2026-08-19: it read a Stripe client secret from
// sessionStorage that only the tripwire offer page ever set, so it became
// unreachable when that page was cut. Subscription checkout is unaffected --
// it goes through the create-checkout function to a Stripe-hosted page.
// /bills/new (NewBillUpload + BillUploadWizard) retired 2026-08-21: it was the
// third way to create an expense. See the note on /bills/new below.
// Retired 2026-08-20 (workstream F6). These belonged to the pre-bank-sync
// product and the spec replaces rather than reuses them:
//   Collections / CollectionDetail / NewCollection — care events. Grouping
//     expenses by vendor is deferred past v1 until the core object model is
//     settled, so the whole surface goes rather than half of it.
//   Ledger — the second expense list, plus the clustering that fed care
//     events. Its inbox queue is superseded by ReviewFeed on /transactions.
//   Calculator — the public four-step marketing quiz.
//   HSAEligibility — the browsable Pub 502 reference. The classifier's
//     pub_502_rules table is the surviving source of truth.
//   PrePurchaseDecision — the savings calculator.
//   PaymentEntry — recorded part-payments against a bill. The spec's money
//     model is an editable reimbursable amount plus splitting, and states
//     "no partial-payment ledger", so this has no successor by design.
//   Reports — its charts were cut on 2026-08-19; the tax export it wrapped
//     now lives on /substantiation next to the claim it belongs to.
//   WellbieRedirect — the AI chat assistant, removed entirely on 2026-08-31.
// Provider Directory removed - V2 feature
// const ProviderDirectory = lazy(() => import("./pages/ProviderDirectory"));
// const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
// const ProviderTransparency = lazy(() => import("./pages/ProviderTransparency"));
// Provider reviews removed 2026-08-19 (workstream F5): a ratings system is a
// separate product and is no longer on the roadmap.
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const Guide = lazy(() => import("./pages/Guide"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Loading fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Global query defaults + toast-on-error. Pages that want a custom error
// message set `meta: { errorMessage: "..." }` on their useQuery call. Pages
// that want to handle their own errors (form submissions, etc.) opt out with
// `meta: { suppressErrorToast: true }`.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (_error, query) => {
      const meta = query.meta as
        { errorMessage?: string; suppressErrorToast?: boolean } | undefined;
      if (meta?.suppressErrorToast) return;
      toast.error(
        meta?.errorMessage ??
          "We're having trouble loading your data. Please try again.",
      );
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Redirect to /transactions keeping the query string and hash.
 *
 * A bare <Navigate to="/transactions"> drops them, which would quietly break
 * the bookmarks this redirect exists to protect: /expenses?tab=review lands on
 * the All tab instead of the review queue, with nothing to say why.
 */
const RedirectToTransactions = () => {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/transactions", search, hash }} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <SubscriptionProvider>
          <HSAProvider>
            <DashboardLayoutProvider>
              <Sonner />
              <BrowserRouter>
                <PWAInstallPrompt />
                <PWAUpdatePrompt />
                <CookieConsent />
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {/* Public routes */}
                      <Route path="/" element={<Index />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/install" element={<Install />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />
                      <Route path="/terms" element={<TermsOfService />} />

                      {/* Protected routes */}
                      <Route
                        path="/dashboard"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Dashboard />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* One list, one name (2026-08-20).

                            There were three: /transactions (categorize),
                            /bills and /expenses (the same expense list on two
                            URLs). Bank transactions and expenses are genuinely
                            different objects -- one transaction can become
                            several expenses -- but to the person looking at
                            them both are "money I spent", and three URLs for
                            that was the confusion. They are now tabs on one
                            page: Review / All / Medical / Non-Medical read
                            transactions, "To claim" renders the expense list
                            embedded.

                            /bills and /transactions redirect rather than 404:
                            both have been live long enough to be bookmarked
                            and to sit in the installed app's history. */}
                      {/* Renamed 2026-09-06: this page lists TRANSACTIONS, and
                          calling it Expenses cost real confusion -- an expense
                          is the claim you build from a transaction, carries the
                          date of service and the documentation, and is what
                          /substantiate lists. Step one is now named for the
                          object it actually shows.

                          The direction of the /transactions redirect flipped:
                          it is the real route now, and /expenses redirects to
                          it. /expenses keeps working rather than moving to the
                          page now LABELLED Expenses, because it has been live
                          long enough to be bookmarked and to sit in the
                          installed app's history -- pointing an existing
                          bookmark at a different-but-plausible page is a
                          silent break, not an error anyone would notice. */}
                      <Route
                        path="/transactions"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Transactions />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/bills"
                        element={<RedirectToTransactions />}
                      />
                      <Route
                        path="/expenses"
                        element={<RedirectToTransactions />}
                      />
                      {/* One way in, one way out (2026-08-21).

                          There were three ways to create an expense:
                          /bills/new ran a five-step upload wizard,
                          "Add manually" on the expense list opened a dialog
                          that wrote a *transaction* instead of an expense,
                          and /expenses/new wrote the expense directly. Three
                          buttons, three different records, no way for the
                          person clicking to know which they were getting.

                          /expenses/new survives because it is the only one
                          that asks for the things an audit needs — patient
                          from the family roster, date of service separate
                          from date of payment — and the only one that can
                          record mileage, which has no transaction at all. It
                          absorbed the wizard's receipt scanning, so nothing
                          the wizard did is lost.

                          Both old URLs redirect: /bills/new was linked from
                          eight places in the app and from onboarding email. */}
                      <Route
                        path="/bills/new"
                        element={<Navigate to="/expenses/new" replace />}
                      />
                      <Route
                        path="/bills/upload"
                        element={<Navigate to="/expenses/new" replace />}
                      />
                      <Route
                        path="/bills/:id"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <BillDetail />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Workstream E1. The legacy reimbursement path is
                          gone; these three routes redirect rather than 404.
                          They have been live long enough to be bookmarked, to
                          sit in the installed app's history, and to appear in
                          old emails — and a dead link is how a user concludes
                          their reimbursement history was deleted. */}
                      <Route
                        path="/reimbursement-requests"
                        element={<Navigate to="/substantiation" replace />}
                      />
                      <Route
                        path="/reimbursement/:id"
                        element={<Navigate to="/substantiation" replace />}
                      />
                      <Route
                        path="/hsa-reimbursement"
                        element={<Navigate to="/substantiation" replace />}
                      />

                      <Route
                        path="/bank-accounts"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <BankAccounts />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* Step 0 — "connect first, configure second".
                            /dashboard sends users here until they finish it.
                            Ordering matters: this asks for a bank connection
                            and nothing else, then hands off to
                            /onboarding/import, which shows the user what
                            Reclaim found before any question is asked. */}
                      <Route
                        path="/welcome"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Welcome />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* Reclaim Phase 2 W3: historical-import wow moment */}
                      <Route
                        path="/onboarding/import"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <HistoricalImport />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* Reclaim Phase 2 W4: manual expense entry fallback */}
                      <Route
                        path="/expenses/new"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <ExpenseEntry />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* Reclaim Phase 5 W2: Substantiate — step two of
                          Categorize -> Substantiate -> Reimburse. Attaching a
                          document and confirming eligibility, in one place. */}
                      <Route
                        path="/substantiate"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Substantiate />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* /review was Phase 3's classification queue. Its work
                          moved to /substantiate; the path stays as a redirect
                          so old links and bookmarks don't 404. */}
                      <Route
                        path="/review"
                        element={<Navigate to="/substantiate" replace />}
                      />
                      {/* Reclaim Phase 4 W1+W2: Substantiation Record generation + SUBMITTED state */}
                      <Route
                        path="/substantiation"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Substantiation />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Supporting Routes */}
                      <Route
                        path="/documents"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Documents />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/settings"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Settings />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* The tax export moved onto /substantiation, so a
                          bookmarked /reports still lands on the thing the
                          user wanted rather than a 404. The retired routes
                          above get no such redirect: their features are gone,
                          not relocated, and pointing them somewhere plausible
                          would only be confusing. */}
                      <Route
                        path="/reports"
                        element={<Navigate to="/substantiation" replace />}
                      />

                      <Route
                        path="/guide"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Guide />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </BrowserRouter>
            </DashboardLayoutProvider>
          </HSAProvider>
        </SubscriptionProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
