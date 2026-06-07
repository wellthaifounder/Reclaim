import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { HSAProvider } from "@/contexts/HSAContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { DashboardLayoutProvider } from "@/contexts/DashboardLayoutContext";
import { WellbieChat } from "@/components/WellbieChat";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FF } from "@/lib/featureFlags";
import { Loader2 } from "lucide-react";

// Critical pages - load immediately
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";

// Lazy load non-critical pages for better performance
const Calculator = lazy(() => import("./pages/Calculator"));
const Bills = lazy(() => import("./pages/Bills"));
const BillDetail = lazy(() => import("./pages/BillDetail"));
const Transactions = lazy(() => import("./pages/Transactions"));
const PrePurchaseDecision = lazy(() => import("./pages/PrePurchaseDecision"));
const HSAEligibility = lazy(() => import("./pages/HSAEligibility"));
const ReimbursementRequests = lazy(
  () => import("./pages/ReimbursementRequests"),
);
const ReimbursementDetails = lazy(() => import("./pages/ReimbursementDetails"));
const HSAReimbursement = lazy(() => import("./pages/HSAReimbursement"));
const BankAccounts = lazy(() => import("./pages/BankAccounts"));
const HistoricalImport = lazy(() => import("./pages/HistoricalImport"));
const ExpenseEntry = lazy(() => import("./pages/ExpenseEntry"));
const Review = lazy(() => import("./pages/Review"));
const Substantiation = lazy(() => import("./pages/Substantiation"));
const Documents = lazy(() => import("./pages/Documents"));
const Settings = lazy(() => import("./pages/Settings"));
const Install = lazy(() => import("./pages/Install"));
const Reports = lazy(() => import("./pages/Reports"));
const TripwireSuccess = lazy(() => import("./pages/TripwireSuccess"));
const TripwireOffer = lazy(() => import("./pages/TripwireOffer"));
const Checkout = lazy(() => import("./pages/Checkout"));
const NewBillUpload = lazy(() => import("./pages/NewBillUpload"));
const Ledger = lazy(() => import("./pages/Ledger"));
// Collections pages
const PaymentEntry = lazy(() => import("./pages/PaymentEntry"));
const Collections = lazy(() => import("./pages/Collections"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const NewCollection = lazy(() => import("./pages/NewCollection"));
// Provider Directory removed - V2 feature
// const ProviderDirectory = lazy(() => import("./pages/ProviderDirectory"));
// const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
// const ProviderTransparency = lazy(() => import("./pages/ProviderTransparency"));
const UserReviews = lazy(() => import("./pages/UserReviews"));
const AdminReviews = lazy(() => import("./pages/AdminReviews"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Guide = lazy(() => import("./pages/Guide"));
const WellbieRedirect = lazy(() => import("./pages/WellbieRedirect"));
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
        | { errorMessage?: string; suppressErrorToast?: boolean }
        | undefined;
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SubscriptionProvider>
        <HSAProvider>
          <OnboardingProvider>
            <DashboardLayoutProvider>
              <Sonner />
              <BrowserRouter>
                <PWAInstallPrompt />
                <PWAUpdatePrompt />
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {/* Public routes */}
                      <Route path="/" element={<Index />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/calculator" element={<Calculator />} />
                      <Route
                        path="/tripwire-offer"
                        element={<TripwireOffer />}
                      />
                      <Route
                        path="/tripwire-success"
                        element={<TripwireSuccess />}
                      />
                      <Route path="/checkout" element={<Checkout />} />
                      <Route path="/install" element={<Install />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />

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

                      {/* Unified Bills Management Routes */}
                      <Route
                        path="/bills"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Bills />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/bills/new"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <NewBillUpload />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      {/* /bills/upload was a duplicate of /bills/new — kept as a redirect for any external bookmarks */}
                      <Route
                        path="/bills/upload"
                        element={<Navigate to="/bills/new" replace />}
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

                      {/* Decision Tool renamed to Savings Calculator (HSA only) */}
                      <Route
                        path="/savings-calculator"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <PrePurchaseDecision />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/decision-tool"
                        element={
                          <ProtectedRoute>
                            <PrePurchaseDecision />
                          </ProtectedRoute>
                        }
                      />
                      {/* Legacy alias — stale bookmarks/marketing links may still point here */}
                      <Route
                        path="/hsa-calculator"
                        element={<Navigate to="/savings-calculator" replace />}
                      />
                      {/* Wellbie is a modal, not a page — this route opens the chat and bounces to the dashboard */}
                      <Route path="/wellbie" element={<WellbieRedirect />} />

                      {/* HSA Routes */}
                      <Route
                        path="/hsa-eligibility"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <HSAEligibility />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/reimbursement-requests"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <ReimbursementRequests />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/reimbursement/:id"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <ReimbursementDetails />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/hsa-reimbursement"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <HSAReimbursement />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Payment Routes */}
                      <Route
                        path="/payments/new"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <PaymentEntry />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/payment/new"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <PaymentEntry />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Transactions Route */}
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
                        path="/bank-accounts"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <BankAccounts />
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
                      {/* Reclaim Phase 3: classification review + audit-trail capture */}
                      <Route
                        path="/review"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Review />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
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

                      {/* Collections Routes */}
                      <Route
                        path="/collections"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Collections />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/collections/new"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <NewCollection />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/collections/:id"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <CollectionDetail />
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

                      <Route
                        path="/reports"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <Reports />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* User Feedback */}
                      <Route
                        path="/user-reviews"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <UserReviews />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Admin Routes */}
                      <Route
                        path="/admin/reviews"
                        element={
                          <ProtectedRoute>
                            <ErrorBoundary>
                              <AdminReviews />
                            </ErrorBoundary>
                          </ProtectedRoute>
                        }
                      />

                      {/* Unified Ledger View. With FF.BILLS_LEDGER_IA_COLLAPSE
                          on (Wave 4 IA-collapse experiment), /ledger 301s into
                          /bills?view=ledger so Bills can render it inline as
                          a tab. With the flag off, the standalone route is
                          unchanged. */}
                      <Route
                        path="/ledger"
                        element={
                          FF.BILLS_LEDGER_IA_COLLAPSE ? (
                            <Navigate to="/bills?view=ledger" replace />
                          ) : (
                            <ProtectedRoute>
                              <ErrorBoundary>
                                <Ledger />
                              </ErrorBoundary>
                            </ProtectedRoute>
                          )
                        }
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
          </OnboardingProvider>
        </HSAProvider>
      </SubscriptionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
