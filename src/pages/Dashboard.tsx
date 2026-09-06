// Reclaim Phase 5 W1 — Dashboard rewrite to the state-machine action queue.
//
// One primary number (available to reclaim) and a queue of buckets the user
// steps through to complete the reimbursement loop.
//
// **The queue is grouped by the three steps of the spine** (2026-09-06):
//
//   1. CATEGORIZE   → transactions waiting for a medical / not-medical call
//   2. SUBSTANTIATE → needs receipt, pending review
//   3. REIMBURSE    → ready to submit, submitted
//
// Step 1 had no bucket at all until now, which meant the front door could say
// "You're all caught up" over a review queue holding twenty-seven undecided
// transactions -- the one step of the workflow that cannot proceed without the
// user was the only one the dashboard never mentioned. The three headings show
// even when a step is empty: they are the map of the product, and a map that
// disappears when you are on top of your work teaches nothing.
//
// The step-1 count comes from useAttentionItems, which defines it to match
// review_feed_groups() exactly. Do not re-derive it here.
//
// Empty state ("you're all caught up — $X reclaimed this year") never
// shows a void; the reclaimed-YTD figure always provides a sense of
// progress.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useReimbursementStrategy } from "@/hooks/useReimbursementStrategy";
import { useAttentionItems } from "@/hooks/useAttentionItems";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt,
  Eye,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  PiggyBank,
  Camera,
  Keyboard,
  Tags,
} from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { formatCurrency } from "@/lib/utils";

interface BucketCounts {
  count: number;
  total: number;
}

interface DashboardData {
  needsReceipt: BucketCounts;
  pendingReview: BucketCounts;
  eligible: BucketCounts;
  submitted: BucketCounts;
  reclaimedYtd: number;
}

// A factory, not a shared constant. This used to be one frozen-looking `ZERO`
// object assigned to all four bucket keys, copied with `{ ...EMPTY_DATA }` --
// a one-level copy, so every key still pointed at that same object. All four
// counters were therefore the same counter: `needsReceipt.count++` also
// incremented `submitted.count`, and the four buckets rendered identical
// figures (2/2/9/2 items showed as 15/15/15/15, and the headline came out as
// exactly double one bucket). Because `ZERO` was module-level and mutated in
// place, the totals also accumulated across reloads.
//
// Each call returns four independent objects. Do not hoist this back into a
// constant.
function emptyDashboardData(): DashboardData {
  return {
    needsReceipt: { count: 0, total: 0 },
    pendingReview: { count: 0, total: 0 },
    eligible: { count: 0, total: 0 },
    submitted: { count: 0, total: 0 },
    reclaimedYtd: 0,
  };
}

const CURRENT_YEAR = new Date().getFullYear();

// Was a file-local formatter, one of seven across the app. Output is identical
// to the canonical one; this just stops it being an eighth.
const fmtMoney = formatCurrency;

export default function Dashboard() {
  const navigate = useNavigate();
  const { isShoebox } = useReimbursementStrategy();
  const {
    unreviewedTransactions,
    unreviewedAmount,
    isLoading: attentionLoading,
  } = useAttentionItems();
  const { isComplete: onboardingComplete } = useOnboardingStatus();
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);

  // Step 0. Auth sends every sign-in to /dashboard, which makes this the one
  // place a new user reliably passes through -- so the setup gate lives here
  // rather than in ProtectedRoute, where it would have to special-case its own
  // destination on every authenticated route in the app.
  //
  // `null` means we do not know yet and must not act: reading it as "not
  // complete" would bounce an existing user into the welcome flow for the
  // moment before their profile row loads.
  useEffect(() => {
    if (onboardingComplete === false) {
      navigate("/welcome", { replace: true });
    }
  }, [onboardingComplete, navigate]);

  useEffect(() => {
    let cancelled = false;
    // 3s safety timeout so we never strand the user on a skeleton if a
    // Supabase call hangs. Matches the previous Dashboard's pattern.
    const timeout = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 3000);

    async function load() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          navigate("/auth", { replace: true });
          return;
        }

        // Workstream E6: the strategy is no longer fetched here. It lives in
        // useReimbursementStrategy, so this page, the attention banner and the
        // claim screen cannot disagree about which one the user chose.
        const { data: invoiceRows } = await supabase
          .from("invoices")
          .select("lifecycle_status, amount, date, reimbursed_at")
          .eq("user_id", user.id);

        const fresh: DashboardData = emptyDashboardData();

        for (const row of invoiceRows ?? []) {
          const amount = Number(row.amount) || 0;
          switch (row.lifecycle_status) {
            // 'captured' counts as needing a receipt (2026-09-06). It means no
            // document and no eligibility decision, which is exactly the work
            // this bucket names. Falling through every case instead, it made
            // the dashboard report "You're all caught up" and $0.00 over a
            // Substantiate queue holding twenty expenses -- the same omission
            // that hid six real ones worth $2,642.13.
            case "captured":
            case "needs_receipt":
              fresh.needsReceipt.count++;
              fresh.needsReceipt.total += amount;
              break;
            case "pending_review":
              fresh.pendingReview.count++;
              fresh.pendingReview.total += amount;
              break;
            case "eligible":
              fresh.eligible.count++;
              fresh.eligible.total += amount;
              break;
            case "submitted":
              fresh.submitted.count++;
              fresh.submitted.total += amount;
              break;
            case "reimbursed": {
              const ts = row.reimbursed_at;
              if (ts && new Date(ts as string).getFullYear() === CURRENT_YEAR) {
                fresh.reclaimedYtd += amount;
              }
              break;
            }
          }
        }

        if (!cancelled) setData(fresh);
      } catch (err) {
        logError("Dashboard.load", err);
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [navigate]);

  // Available to reclaim = ELIGIBLE + NEEDS_RECEIPT (per brief §8).
  //
  // Undecided transactions are deliberately NOT in this figure. Nobody has
  // said they are medical yet, and putting money the user has not claimed into
  // the headline is the auto-categorization the whole approval flow exists to
  // undo. It gets its own bucket instead.
  const availableToReclaim = data.eligible.total + data.needsReceipt.total;
  const allClear =
    !loading &&
    unreviewedTransactions === 0 &&
    data.needsReceipt.count === 0 &&
    data.pendingReview.count === 0 &&
    data.eligible.count === 0 &&
    data.submitted.count === 0;

  if (loading || attentionLoading) {
    return (
      <AuthenticatedLayout>
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8 space-y-4">
        {/* Primary number — sum of ELIGIBLE + NEEDS_RECEIPT */}
        <Card className="border-primary/30">
          <CardContent className="p-5 sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              {isShoebox
                ? "Shoebox balance + receipts pending"
                : "Available to reclaim"}
            </p>
            <p className="text-4xl sm:text-5xl font-bold tabular-nums">
              {fmtMoney(availableToReclaim)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {data.eligible.count + data.needsReceipt.count} expense
              {data.eligible.count + data.needsReceipt.count === 1
                ? ""
                : "s"}{" "}
              across the action queue
            </p>
          </CardContent>
        </Card>

        {/* Persistent add-expense affordance — two parallel CTAs framed by
            the user's artifact ("what do you have in your hand?"). Receipt-
            first is the brief's kill-shot; manual is the receipt-less
            fallback. Substantiation is deliberately absent — that's an
            output generated on /substantiation, not an input mode. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/expenses/new")}
            className="justify-center"
          >
            <Camera className="h-4 w-4 mr-2" />
            Snap a receipt
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/expenses/new")}
            className="justify-center"
          >
            <Keyboard className="h-4 w-4 mr-2" />
            Log an expense
          </Button>
        </div>

        {/* All-caught-up empty state */}
        {allClear ? (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500" />
              <h2 className="text-xl font-semibold">You're all caught up</h2>
              <p className="text-sm text-muted-foreground">
                {data.reclaimedYtd > 0
                  ? `${fmtMoney(data.reclaimedYtd)} reclaimed this year.`
                  : "Snap a receipt or log an expense above to start reclaiming."}
              </p>
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/substantiate")}
                >
                  See all expenses
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Step 1 · Categorize ───────────────────────────────────── */}
            <StepHeading step={1} name="Categorize" />
            <BucketCard
              icon={Tags}
              tone="sky"
              label="Waiting on you"
              count={unreviewedTransactions}
              total={unreviewedAmount}
              noun="transaction"
              copy="Say which of these were medical"
              ctaLabel="Categorize"
              onClick={() => navigate("/transactions?tab=review")}
            />

            {/* ── Step 2 · Substantiate ─────────────────────────────────── */}
            <StepHeading step={2} name="Substantiate" />
            <BucketCard
              icon={Receipt}
              tone="amber"
              label="Needs receipt"
              count={data.needsReceipt.count}
              total={data.needsReceipt.total}
              copy="Attach receipts before you forget"
              ctaLabel="Attach"
              onClick={() => navigate("/substantiate")}
            />
            <BucketCard
              icon={Eye}
              tone="violet"
              label="Pending review"
              count={data.pendingReview.count}
              total={data.pendingReview.total}
              copy="Confirm these are HSA-eligible"
              ctaLabel="Review"
              onClick={() => navigate("/substantiate")}
            />

            {/* ── Step 3 · Reimburse ────────────────────────────────────── */}
            <StepHeading step={3} name="Reimburse" />
            {/* READY TO SUBMIT  /  Shoebox Balance */}
            <BucketCard
              icon={isShoebox ? PiggyBank : CheckCircle2}
              tone="emerald"
              label={isShoebox ? "Shoebox balance" : "Ready to submit"}
              count={data.eligible.count}
              total={data.eligible.total}
              copy={
                isShoebox
                  ? "Saved for future reimbursement"
                  : "Generate your Reimbursement Record"
              }
              ctaLabel={isShoebox ? "" : "Submit"}
              onClick={
                isShoebox ? undefined : () => navigate("/substantiation")
              }
            />
            <BucketCard
              icon={Clock}
              tone="slate"
              label="Submitted"
              count={data.submitted.count}
              total={data.submitted.total}
              copy="Waiting for HSA deposit"
              ctaLabel="Track"
              onClick={() => navigate("/substantiation")}
            />

            {/* Reclaimed YTD footer */}
            {data.reclaimedYtd > 0 && (
              <p className="text-xs text-center text-muted-foreground pt-2">
                <Sparkles className="inline h-3 w-3 mr-1 text-emerald-600" />
                {fmtMoney(data.reclaimedYtd)} reclaimed this year
              </p>
            )}
          </>
        )}
      </div>
    </AuthenticatedLayout>
  );
}

// ── Step heading ────────────────────────────────────────────────────────

/**
 * The name of one step of the spine, over the buckets belonging to it.
 *
 * Numbered because the steps really are a sequence -- an expense cannot be
 * substantiated before it is categorized, or claimed before it is
 * substantiated -- so the numbers carry information rather than decoration.
 */
function StepHeading({ step, name }: { step: number; name: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 first:pt-0">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
        {step}
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {name}
      </h2>
    </div>
  );
}

// ── Bucket card ─────────────────────────────────────────────────────────

// Each tone needs a dark pair. The light-only fills these replaced put a
// near-white disc on a dark page -- the brightest thing on the screen, on the
// decoration rather than the number.
const TONE_STYLES: Record<
  "sky" | "amber" | "violet" | "emerald" | "slate",
  { icon: string; bg: string }
> = {
  sky: {
    icon: "text-sky-700 dark:text-sky-300",
    bg: "bg-sky-50 dark:bg-sky-950",
  },
  amber: {
    icon: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950",
  },
  violet: {
    icon: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-950",
  },
  emerald: {
    icon: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950",
  },
  slate: {
    icon: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-800",
  },
};

interface BucketCardProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: "sky" | "amber" | "violet" | "emerald" | "slate";
  label: string;
  count: number;
  total: number;
  /** What this bucket counts. Step 1 holds transactions, not expenses yet. */
  noun?: string;
  copy: string;
  ctaLabel: string;
  onClick?: () => void;
}

function BucketCard({
  icon: Icon,
  tone,
  label,
  count,
  total,
  noun = "expense",
  copy,
  ctaLabel,
  onClick,
}: BucketCardProps) {
  // Empty buckets render dimmed and not actionable so the queue's signal
  // stays strong (only "real" work draws the eye).
  const dimmed = count === 0;
  const styles = TONE_STYLES[tone];
  const interactive = !!onClick && !dimmed && !!ctaLabel;
  return (
    <Card className={dimmed ? "opacity-60" : ""}>
      <CardContent className="p-4 sm:p-5 flex items-center gap-4">
        <div
          className={`rounded-full ${styles.bg} p-2.5 shrink-0`}
          aria-hidden="true"
        >
          <Icon className={`h-5 w-5 ${styles.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-semibold text-sm sm:text-base">{label}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {count} {noun}
              {count === 1 ? "" : "s"} · {fmtMoney(total)}
            </p>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {copy}
          </p>
        </div>
        {interactive && (
          <Button size="sm" onClick={onClick} className="shrink-0">
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
