// Reclaim Phase 3 — Review queue (the audit-trail capture surface).
//
// Shows PENDING_REVIEW and NEEDS_RECEIPT invoices joined to their assigned
// Pub 502 rule. Each card surfaces:
//   - vendor / amount / date / patient
//   - AI / MCC-assigned Pub 502 rule + eligibility status + confidence
//   - reasoning string (verbatim from classifier — never paraphrased)
//   - warnings (low confidence, missing receipt, etc.)
//
// Three actions per card:
//   - **Confirm eligible** — lifecycle_status → ELIGIBLE, confirmed_at = now()
//   - **Mark ineligible** — lifecycle_status → INELIGIBLE, confirmed_at = now()
//   - **Needs receipt**   — lifecycle_status → NEEDS_RECEIPT (no audit trail
//                            yet; user hasn't confirmed eligibility)
//
// The brief calls confirmed_at THE audit-trail moat: Substantiation Records
// (Phase 4) cite this timestamp as the user's explicit eligibility-
// determination event. Confirmation is irreversible from this UI — a future
// "undo last confirmation" affordance can come later, but for v1 we keep
// the act of confirmation deliberate.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Receipt,
  AlertTriangle,
  Sparkles,
  ArrowLeft,
  CalendarDays,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

type Lifecycle = "pending_review" | "needs_receipt";

interface PendingExpense {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  category: string;
  patient_name: string | null;
  notes: string | null;
  lifecycle_status: Lifecycle;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  classification_warnings: string[] | null;
  classified_at: string | null;
  receipt_count: number;
  rule: {
    id: string;
    name: string;
    eligibility_status: "eligible" | "conditional" | "ineligible";
    section_ref: string | null;
    conditions: string | null;
  } | null;
}

function confidenceTier(c: number | null): {
  label: string;
  className: string;
} {
  if (c == null)
    return {
      label: "Awaiting AI",
      className: "bg-slate-100 text-slate-700 border-slate-200",
    };
  if (c >= 0.85)
    return {
      label: `High (${Math.round(c * 100)}%)`,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  if (c >= 0.6)
    return {
      label: `Medium (${Math.round(c * 100)}%)`,
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  return {
    label: `Low (${Math.round(c * 100)}%)`,
    className: "bg-red-50 text-red-700 border-red-200",
  };
}

export default function Review() {
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState<PendingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }

      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, vendor, amount, date, category, patient_name, notes,
           lifecycle_status, classification_confidence, classification_reasoning,
           classification_warnings, classified_at,
           rule:pub_502_rules!eligibility_basis_rule_id ( id, name, eligibility_status, section_ref, conditions ),
           receipts ( id )`,
        )
        .eq("user_id", user.id)
        .in("lifecycle_status", ["pending_review", "needs_receipt"])
        .order("classified_at", { ascending: false, nullsFirst: false })
        .order("date", { ascending: false })
        .limit(200);

      if (error) throw error;

      const rows: PendingExpense[] = (data ?? []).map((r: unknown) => {
        const row = r as Record<string, unknown> & {
          rule: PendingExpense["rule"] | PendingExpense["rule"][] | null;
          receipts: { id: string }[] | null;
          classification_warnings: unknown;
        };
        const rule = Array.isArray(row.rule)
          ? (row.rule[0] ?? null)
          : (row.rule ?? null);
        const warnings = Array.isArray(row.classification_warnings)
          ? (row.classification_warnings as string[])
          : null;
        return {
          id: row.id as string,
          vendor: row.vendor as string,
          amount: Number(row.amount),
          date: row.date as string,
          category: row.category as string,
          patient_name: (row.patient_name as string | null) ?? null,
          notes: (row.notes as string | null) ?? null,
          lifecycle_status: row.lifecycle_status as Lifecycle,
          classification_confidence:
            (row.classification_confidence as number | null) ?? null,
          classification_reasoning:
            (row.classification_reasoning as string | null) ?? null,
          classification_warnings: warnings,
          classified_at: (row.classified_at as string | null) ?? null,
          receipt_count: (row.receipts ?? []).length,
          rule,
        };
      });

      setExpenses(rows);
    } catch (err) {
      logError("Review.load", err);
      toast.error("Couldn't load your review queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const pending = expenses.filter(
      (e) => e.lifecycle_status === "pending_review",
    );
    const needsReceipt = expenses.filter(
      (e) => e.lifecycle_status === "needs_receipt",
    );
    const pendingDollars = pending.reduce((s, e) => s + e.amount, 0);
    return {
      pendingCount: pending.length,
      needsReceiptCount: needsReceipt.length,
      pendingDollars,
    };
  }, [expenses]);

  const act = async (
    id: string,
    next: "eligible" | "ineligible" | "needs_receipt",
  ) => {
    setActingId(id);
    try {
      const now = new Date().toISOString();
      // confirmed_at is set ONLY when the user makes an audit-trail-quality
      // determination (eligible/ineligible). "needs_receipt" is a deferral,
      // not an eligibility decision.
      const update: Record<string, unknown> = { lifecycle_status: next };
      if (next === "eligible" || next === "ineligible") {
        update.confirmed_at = now;
      }
      const { error } = await supabase
        .from("invoices")
        .update(update)
        .eq("id", id);
      if (error) throw error;

      setExpenses((prev) => prev.filter((e) => e.id !== id));
      toast.success(
        next === "eligible"
          ? "Confirmed eligible. Logged with timestamp."
          : next === "ineligible"
            ? "Marked ineligible."
            : "Flagged as needing a receipt.",
      );
    } catch (err) {
      logError("Review.act", err);
      toast.error("Could not save that decision. Please try again.");
    } finally {
      setActingId(null);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
          <p className="text-sm text-muted-foreground">
            Loading your review queue…
          </p>
        </div>
      </AuthenticatedLayout>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (expenses.length === 0) {
    return (
      <AuthenticatedLayout>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <Card>
            <CardContent className="p-10 text-center space-y-4">
              <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500" />
              <h2 className="text-xl font-semibold">You're all caught up</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                When new expenses land from Plaid or your uploads, they'll show
                up here for review and confirmation.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="outline" onClick={() => navigate("/bills")}>
                  See all bills
                </Button>
                <Button onClick={() => navigate("/dashboard")}>
                  Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AuthenticatedLayout>
    );
  }

  // ── Queue ────────────────────────────────────────────────────────────────
  return (
    <AuthenticatedLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-1">Review your expenses</h1>
          <p className="text-sm text-muted-foreground">
            Confirm eligibility now — each confirmation is the audit-trail event
            your Substantiation Record will cite.
          </p>
          <div className="flex gap-2 mt-3 text-xs">
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-700 border-amber-200"
            >
              {totals.pendingCount} pending · $
              {totals.pendingDollars.toFixed(2)}
            </Badge>
            {totals.needsReceiptCount > 0 && (
              <Badge
                variant="outline"
                className="bg-slate-100 text-slate-700 border-slate-200"
              >
                {totals.needsReceiptCount} needs receipt
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {expenses.map((e) => {
            const tier = confidenceTier(e.classification_confidence);
            const ineligibleByRule =
              e.rule?.eligibility_status === "ineligible";
            return (
              <Card key={e.id}>
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{e.vendor}</p>
                      <p className="text-sm text-muted-foreground">
                        ${e.amount.toFixed(2)} ·{" "}
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(e.date + "T00:00:00").toLocaleDateString()}
                        </span>{" "}
                        ·{" "}
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {e.patient_name ?? "Self"}
                        </span>
                      </p>
                    </div>
                    <Badge variant="outline" className={tier.className}>
                      {tier.label}
                    </Badge>
                  </div>

                  {e.rule ? (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Sparkles className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                        <p className="text-sm font-medium">{e.rule.name}</p>
                        <Badge
                          variant="outline"
                          className={
                            e.rule.eligibility_status === "eligible"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                              : e.rule.eligibility_status === "conditional"
                                ? "bg-amber-50 text-amber-700 border-amber-200 text-xs"
                                : "bg-red-50 text-red-700 border-red-200 text-xs"
                          }
                        >
                          {e.rule.eligibility_status}
                        </Badge>
                        {e.rule.section_ref && (
                          <span className="text-[11px] text-muted-foreground">
                            {e.rule.section_ref}
                          </span>
                        )}
                      </div>
                      {e.classification_reasoning && (
                        <p className="text-xs text-muted-foreground">
                          {e.classification_reasoning}
                        </p>
                      )}
                      {e.rule.conditions && (
                        <p className="text-xs text-amber-700">
                          Conditions: {e.rule.conditions}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground italic">
                      Awaiting AI classification. You can still confirm or
                      reject based on your own judgment.
                    </div>
                  )}

                  {(e.classification_warnings?.length ?? 0) > 0 && (
                    <ul className="space-y-1">
                      {e.classification_warnings!.map((w, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-amber-700"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {e.lifecycle_status === "needs_receipt" && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700">
                      <Receipt className="h-3.5 w-3.5" />
                      You marked this as needing a receipt. Attach one before
                      confirming eligibility.
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      onClick={() => act(e.id, "eligible")}
                      disabled={actingId === e.id || ineligibleByRule}
                      className="flex-1"
                    >
                      {actingId === e.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Confirm eligible
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => act(e.id, "ineligible")}
                      disabled={actingId === e.id}
                      className="flex-1"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Mark ineligible
                    </Button>
                    {e.lifecycle_status !== "needs_receipt" && (
                      <Button
                        variant="ghost"
                        onClick={() => act(e.id, "needs_receipt")}
                        disabled={actingId === e.id || e.receipt_count > 0}
                        className="flex-1"
                      >
                        <Receipt className="mr-2 h-4 w-4" />
                        Needs receipt
                      </Button>
                    )}
                  </div>

                  {ineligibleByRule && (
                    <p className="text-xs text-red-700">
                      Pub 502 lists this rule as ineligible. You can override by
                      marking it eligible with notes, but it won't be defensible
                      in an audit.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
