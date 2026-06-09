// Reclaim Phase 5 W1 — Dashboard rewrite to the state-machine action queue.
//
// Replaces the Wellth-era widget-grid dashboard with the action queue from
// brief §8: one primary number (available to reclaim) and four buckets the
// user can step through to complete the reimbursement loop.
//
// Buckets, in narrative order:
//   1. NEEDS RECEIPT     → attach a document to expenses that need one
//   2. PENDING REVIEW    → confirm AI classifications
//   3. READY TO SUBMIT   → bundle ELIGIBLE expenses into a Substantiation
//                          Record (relabeled "Shoebox Balance" for users
//                          on the shoebox strategy, with no CTA)
//   4. SUBMITTED         → waiting on a matching HSA deposit
//
// Empty state ("you're all caught up — $X reclaimed this year") never
// shows a void; the reclaimed-YTD figure always provides a sense of
// progress.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";
import { logError } from "@/utils/errorHandler";

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
  isShoebox: boolean;
}

const ZERO: BucketCounts = { count: 0, total: 0 };
const EMPTY_DATA: DashboardData = {
  needsReceipt: ZERO,
  pendingReview: ZERO,
  eligible: ZERO,
  submitted: ZERO,
  reclaimedYtd: 0,
  isShoebox: false,
};

const CURRENT_YEAR = new Date().getFullYear();

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

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

        const [{ data: invoiceRows }, { data: profileRow }] = await Promise.all(
          [
            supabase
              .from("invoices")
              .select("lifecycle_status, amount, date, reimbursed_at")
              .eq("user_id", user.id),
            supabase
              .from("profiles")
              .select("reimbursement_strategy_preference")
              .eq("id", user.id)
              .maybeSingle(),
          ],
        );

        const fresh: DashboardData = { ...EMPTY_DATA };
        fresh.isShoebox =
          profileRow?.reimbursement_strategy_preference === "shoebox";

        for (const row of invoiceRows ?? []) {
          const amount = Number(row.amount) || 0;
          switch (row.lifecycle_status) {
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
  const availableToReclaim = data.eligible.total + data.needsReceipt.total;
  const allClear =
    !loading &&
    data.needsReceipt.count === 0 &&
    data.pendingReview.count === 0 &&
    data.eligible.count === 0 &&
    data.submitted.count === 0;

  if (loading) {
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
              {data.isShoebox
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
            onClick={() => navigate("/bills/new")}
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
                  onClick={() => navigate("/expenses")}
                >
                  See all expenses
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* NEEDS RECEIPT */}
            <BucketCard
              icon={Receipt}
              tone="amber"
              label="Needs receipt"
              count={data.needsReceipt.count}
              total={data.needsReceipt.total}
              copy="Attach receipts before you forget"
              ctaLabel="Attach"
              onClick={() => navigate("/review")}
            />

            {/* PENDING REVIEW */}
            <BucketCard
              icon={Eye}
              tone="violet"
              label="Pending review"
              count={data.pendingReview.count}
              total={data.pendingReview.total}
              copy="Confirm these are HSA-eligible"
              ctaLabel="Review"
              onClick={() => navigate("/review")}
            />

            {/* READY TO SUBMIT  /  Shoebox Balance */}
            <BucketCard
              icon={data.isShoebox ? PiggyBank : CheckCircle2}
              tone="emerald"
              label={data.isShoebox ? "Shoebox balance" : "Ready to submit"}
              count={data.eligible.count}
              total={data.eligible.total}
              copy={
                data.isShoebox
                  ? "Saved for future reimbursement"
                  : "Generate your Substantiation Record"
              }
              ctaLabel={data.isShoebox ? "" : "Submit"}
              onClick={
                data.isShoebox ? undefined : () => navigate("/substantiation")
              }
            />

            {/* SUBMITTED */}
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

// ── Bucket card ─────────────────────────────────────────────────────────

const TONE_STYLES: Record<
  "amber" | "violet" | "emerald" | "slate",
  { icon: string; bg: string }
> = {
  amber: { icon: "text-amber-700", bg: "bg-amber-50" },
  violet: { icon: "text-violet-700", bg: "bg-violet-50" },
  emerald: { icon: "text-emerald-700", bg: "bg-emerald-50" },
  slate: { icon: "text-slate-700", bg: "bg-slate-100" },
};

interface BucketCardProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: "amber" | "violet" | "emerald" | "slate";
  label: string;
  count: number;
  total: number;
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
              {count} expense{count === 1 ? "" : "s"} · {fmtMoney(total)}
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
