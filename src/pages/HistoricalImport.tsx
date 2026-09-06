// Reclaim Phase 2 W3 — Historical-import activation moment.
//
// Renders the "wow moment" the brief calls brand-defining: after a user
// connects their first Plaid item, we pull 18 months of transactions, run
// them through the medical classifier, auto-capture invoices for high-
// confidence medical merchants, and surface the count on screen.
//
// Three states, one component:
//   - loading : sync in flight (15–60s depending on bank); rotating status copy
//   - result  : counts back; big number + CTA to review the captured queue
//   - error   : sync failed; graceful fallback so the user isn't stranded
//
// We also handle a refresh of this page mid-flow: if route state was lost
// (hard refresh, deep-link), we fall back to reading the most recent
// plaid_connection for the user and showing whatever counts are persisted.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { FocusedLayout } from "@/components/FocusedLayout";
import { PlaidLink } from "@/components/PlaidLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { logError, toUserMessage } from "@/utils/errorHandler";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";

interface SyncResult {
  medical_detected: number;
  total: number;
  inserted: number;
  captured: number;
  auto_linked: number;
  window_days: number;
  institution_name: string;
}

interface RouteState {
  connectionId?: string;
  institutionName?: string;
}

const LOADING_COPY = [
  { text: "Securely connecting to your bank…", min_ms: 0 },
  { text: "Pulling up to 18 months of transactions…", min_ms: 3_000 },
  { text: "Scanning for medical merchants and pharmacies…", min_ms: 9_000 },
  { text: "Checking each against IRS Pub 502…", min_ms: 18_000 },
  { text: "Almost done — assembling your reclaim list…", min_ms: 30_000 },
];

/**
 * This page is reached two ways and needs a different frame for each.
 *
 * Mid-setup it is one beat of the Step 0 flow, so it takes the same bare
 * chrome as /welcome — no sidebar full of empty destinations, no competing
 * "Snap a receipt" button, and no accidental exits while a sync is running.
 * Reached later, by someone connecting a second bank from Settings, it is an
 * ordinary page in an app they already live in and keeps the full navigation.
 *
 * No exit control while the sync is in flight: there is nothing to escape to
 * yet, and the result lands within a minute.
 */
function ImportFrame({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  return focused ? (
    <FocusedLayout>{children}</FocusedLayout>
  ) : (
    <AuthenticatedLayout>{children}</AuthenticatedLayout>
  );
}

export default function HistoricalImport() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state ?? {}) as RouteState;

  // Step 0: this page is the hinge between "connect" and "configure". A user
  // who is still in setup continues into the questions from here; a user who
  // came back later to sync another bank goes straight to their transactions.
  const { isComplete: onboardingComplete } = useOnboardingStatus();
  const midOnboarding = onboardingComplete === false;

  const [phase, setPhase] = useState<"loading" | "result" | "error">("loading");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [startedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);
  // Bumping this re-runs the sync effect. The failure this screen shows is
  // usually transient, so retrying is the action most likely to resolve it --
  // and until now the screen offered no way to do it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        let connectionId = routeState.connectionId;

        // Hard-refresh recovery: route state is gone — find the most
        // recent connection for the current user and try to use that.
        if (!connectionId) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            navigate("/auth", { replace: true });
            return;
          }
          const { data: latest } = await supabase
            .from("plaid_connections")
            .select(
              "id, institution_name, first_sync_completed_at, initial_medical_count, initial_total_count",
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!latest) {
            navigate("/bank-accounts", { replace: true });
            return;
          }

          // If we already completed the first sync for this connection,
          // skip the spinner and render the persisted counts directly.
          if (latest.first_sync_completed_at != null) {
            if (cancelled) return;
            setResult({
              medical_detected: latest.initial_medical_count ?? 0,
              total: latest.initial_total_count ?? 0,
              inserted: latest.initial_total_count ?? 0,
              captured: latest.initial_medical_count ?? 0,
              auto_linked: 0,
              window_days: 540,
              institution_name: latest.institution_name ?? "your bank",
            });
            setPhase("result");
            return;
          }
          connectionId = latest.id;
        }

        const { data, error } = await supabase.functions.invoke(
          "plaid-sync-transactions",
          {
            body: { connection_id: connectionId, is_initial: true },
          },
        );
        if (error) throw error;
        if (cancelled) return;

        setResult({
          medical_detected: data?.medical_detected ?? 0,
          total: data?.total ?? 0,
          inserted: data?.inserted ?? 0,
          captured: data?.captured ?? 0,
          auto_linked: data?.auto_linked ?? 0,
          window_days: data?.window_days ?? 540,
          institution_name:
            data?.institution_name ?? routeState.institutionName ?? "your bank",
        });
        setPhase("result");
      } catch (err) {
        logError("HistoricalImport sync failed", err);
        if (cancelled) return;
        // Was `err instanceof Error ? err.message : <friendly>`, which put the
        // raw "Edge Function returned a non-2xx status code" on screen seconds
        // after the user handed over their bank credentials -- a FunctionsHttpError
        // is an Error, so the friendly branch could never run.
        setErrorMsg(
          toUserMessage(
            err,
            "We couldn't finish the import. Your bank connection is fine — you can try again, or add expenses manually for now.",
          ),
        );
        setPhase("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (phase === "loading") {
    const elapsed = Date.now() - startedAt;
    const currentCopy =
      [...LOADING_COPY].reverse().find((c) => elapsed >= c.min_ms) ??
      LOADING_COPY[0];

    return (
      <ImportFrame focused={midOnboarding}>
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <div className="relative inline-block">
            <Loader2 className="h-16 w-16 mx-auto mb-6 animate-spin text-primary" />
            <Sparkles className="h-5 w-5 absolute -top-1 -right-1 text-violet-500 animate-pulse" />
          </div>
          <h1 className="text-2xl font-semibold mb-3">
            Reclaiming your healthcare history
          </h1>
          <p className="text-muted-foreground mb-8">
            From{" "}
            <span className="font-medium text-foreground">
              {routeState.institutionName || "your bank"}
            </span>
            . This takes 15–60 seconds.
          </p>
          <p
            className="text-sm text-muted-foreground italic"
            key={currentCopy.text}
          >
            {currentCopy.text}
          </p>
        </div>
      </ImportFrame>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <ImportFrame focused={midOnboarding}>
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
          <h1 className="text-2xl font-semibold mb-2">
            We couldn't finish the import
          </h1>
          <p className="text-muted-foreground mb-6">{errorMsg}</p>
          {/* Retry is primary: this failure is usually transient, and moving on
              means walking away from the history the user just connected a bank
              to import. Carrying on stays available, quietly. */}
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-center">
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                setErrorMsg("");
                setPhase("loading");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() =>
                navigate(
                  midOnboarding ? "/welcome?step=household" : "/expenses",
                )
              }
            >
              {midOnboarding ? "Continue setup" : "Continue to expenses"}
            </Button>
          </div>
        </div>
      </ImportFrame>
    );
  }

  // ── Result state (the wow moment) ────────────────────────────────────────
  const r = result!;
  const months = Math.round(r.window_days / 30);

  return (
    <ImportFrame focused={midOnboarding}>
      <div className="max-w-xl mx-auto px-4 py-12">
        <Card className="border-primary/20">
          <CardContent className="p-8 text-center space-y-6">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10">
              <CheckCircle2 className="h-9 w-9 text-primary" />
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Reclaim found
              </p>
              <p className="text-6xl font-bold tabular-nums">
                {r.medical_detected}
              </p>
              <p className="text-base text-muted-foreground mt-2">
                potential HSA-eligible{" "}
                {r.medical_detected === 1 ? "transaction" : "transactions"}
                <br />
                from the last {months} months at{" "}
                <span className="font-medium text-foreground">
                  {r.institution_name}
                </span>
                .
              </p>
            </div>

            {r.total > 0 && (
              <p className="text-xs text-muted-foreground">
                Reviewed {r.total.toLocaleString()} total{" "}
                {r.total === 1 ? "transaction" : "transactions"} · {r.captured}{" "}
                ready for your review
              </p>
            )}

            {/* Mid-setup this is a one-way door on purpose. The spec puts the
                remaining questions AFTER this moment precisely so the user has
                seen their own money first; offering "I'll do it later" here
                would hand back the drop-off the ordering exists to prevent.
                Every individual question on the next screens is still
                skippable. Connecting another account is forward motion, not
                an escape hatch, so it stays consistent with that intent even
                mid-onboarding. */}
            {r.medical_detected === 0 && (
              <div className="rounded-lg border bg-muted/30 p-4 text-left space-y-3">
                <div>
                  <p className="text-sm font-medium">
                    Pay for care with a different card or bank?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reclaim can only see what a connected account shows it —
                    link another one to check that too.
                  </p>
                </div>
                <PlaidLink />
              </div>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                size="lg"
                variant={r.medical_detected === 0 ? "outline" : "default"}
                onClick={() =>
                  navigate(
                    midOnboarding ? "/welcome?step=household" : "/expenses",
                  )
                }
                className="w-full"
              >
                {midOnboarding
                  ? "Next: a few quick questions"
                  : "Review them now"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              {!midOnboarding && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => navigate("/dashboard")}
                  className="w-full"
                >
                  I'll review later
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6 max-w-md mx-auto">
          We won't auto-mark any of these as eligible. You confirm each one —
          that confirmation timestamp is what makes your Medical Expense Record
          audit-defensible.
        </p>
      </div>
    </ImportFrame>
  );
}
