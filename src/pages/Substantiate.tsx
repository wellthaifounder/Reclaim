// Reclaim Phase 5 W2 — Substantiate: step two of Categorize → Substantiate →
// Reimburse.
//
// Step two had no home. The two halves of substantiating an expense lived on
// pages that did not know about each other: attaching a document happened in
// SubstantiateDialog (reachable only from the expense list), and confirming
// eligibility happened on /review, which no nav had linked to since Phase 5 W1.
// A user who wanted to do both did it in two places, or never found the second
// one. This page is the single destination for both, and the nav points at it.
//
// **The queue is lifecycle_status, not a re-derivation.** `needs_receipt` and
// `pending_review` are precisely the two states that mean "this expense needs
// step two", and the column is maintained by trg_invoices_sync_lifecycle from
// the three facets. Re-deriving readiness here from receipts + eligibility
// would be a second opinion that drifts from the trigger's. Query the column.
//
// Two actions per row, both without leaving the page:
//
//   - **Attach a document** — SubstantiateDialog (upload / photo / OCR) or
//     AttachDocumentDialog (reuse a file already on file), unchanged. They are
//     deliberately not wizards: substantiation is resumable by nature, so
//     every field saves on its own. Do not redesign them into a flow.
//   - **Confirm eligible / ineligible** — moved verbatim from /review's act().
//     confirmed_at is the audit-trail moat: Substantiation Records cite that
//     timestamp as the user's explicit eligibility-determination event, so it
//     is stamped ONLY for a real determination, never for a deferral.
//
// Writes go to the facets (eligibility_state / documentation_state), never to
// lifecycle_status — that column is derived and direct writes are overwritten.
//
// **Why a row can stay after you confirm it.** The trigger maps
// `eligibility_state = 'eligible' AND documentation_state = 'none'` to
// needs_receipt, so confirming an expense that has no document leaves it in
// this queue — correctly: it still needs a receipt. So this page refetches and
// lets lifecycle_status decide what stays, rather than optimistically dropping
// the row the way /review did. /review could drop it because confirming was
// the only thing it offered; here, a row that stays with "Confirmed eligible —
// still needs a document" is the honest answer and tells the user what is left.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { AttachDocumentDialog } from "@/components/documents/AttachDocumentDialog";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Receipt,
  Paperclip,
  FolderOpen,
  AlertTriangle,
  Sparkles,
  CalendarDays,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

/**
 * The lifecycle states that mean "step two is not done yet".
 *
 * `captured` joined them on 2026-09-06, when confirming a transaction as
 * medical became the thing that creates its expense. A brand-new expense has
 * eligibility 'unknown' and documentation 'none', which the lifecycle trigger
 * maps to `captured` — no document, no eligibility decision, which is the
 * definition of needing step two.
 *
 * It was excluded before for a reason that no longer holds: expenses used to be
 * created by the sync without anyone approving them, so `captured` was a pile
 * of the app's own guesses and would have buried the real queue. An expense now
 * exists only because the user approved it, so every one of them belongs here.
 * Leaving it out was what made six confirmed expenses worth $2,642.13 land in a
 * queue that said "you're all caught up".
 */
const SUBSTANTIATE_STATES = [
  "captured",
  "needs_receipt",
  "pending_review",
] as const;
type Lifecycle = (typeof SUBSTANTIATE_STATES)[number];

interface QueueExpense {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  patient_name: string | null;
  lifecycle_status: Lifecycle;
  eligibility_state: string | null;
  documentation_state: string | null;
  confirmed_at: string | null;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  classification_warnings: string[] | null;
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
      className: "bg-muted text-muted-foreground border-border",
    };
  if (c >= 0.85)
    return {
      label: `High (${Math.round(c * 100)}%)`,
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
    };
  if (c >= 0.6)
    return {
      label: `Medium (${Math.round(c * 100)}%)`,
      className:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
    };
  return {
    label: `Low (${Math.round(c * 100)}%)`,
    className:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  };
}

export default function Substantiate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);
  const [attachToId, setAttachToId] = useState<string | null>(null);

  const {
    data: expenses = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["substantiate-queue"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<QueueExpense[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth", { replace: true });
        return [];
      }

      // receipt_count comes from receipt_invoices, not the receipts embed --
      // attachment lives in the join table now, so a document attached only
      // through the multi-attach path (AttachDocumentDialog) still needs to
      // count here.
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, vendor, amount, date, patient_name,
           lifecycle_status, eligibility_state, documentation_state, confirmed_at,
           classification_confidence, classification_reasoning,
           classification_warnings,
           rule:pub_502_rules!eligibility_basis_rule_id ( id, name, eligibility_status, section_ref, conditions ),
           receipt_invoices ( receipt_id )`,
        )
        .eq("user_id", user.id)
        .in("lifecycle_status", [...SUBSTANTIATE_STATES])
        .order("date", { ascending: false })
        .limit(500);

      if (error) throw error;

      return (data ?? []).map((r: unknown) => {
        const row = r as Record<string, unknown> & {
          rule: QueueExpense["rule"] | QueueExpense["rule"][] | null;
          receipt_invoices: { receipt_id: string }[] | null;
        };
        // PostgREST returns an embedded to-one relation as an object, but as a
        // single-element array under some join shapes. Normalise both.
        const rule = Array.isArray(row.rule)
          ? (row.rule[0] ?? null)
          : (row.rule ?? null);
        return {
          id: row.id as string,
          vendor: row.vendor as string,
          amount: Number(row.amount),
          date: row.date as string,
          patient_name: (row.patient_name as string | null) ?? null,
          lifecycle_status: row.lifecycle_status as Lifecycle,
          eligibility_state: (row.eligibility_state as string | null) ?? null,
          documentation_state:
            (row.documentation_state as string | null) ?? null,
          confirmed_at: (row.confirmed_at as string | null) ?? null,
          classification_confidence:
            (row.classification_confidence as number | null) ?? null,
          classification_reasoning:
            (row.classification_reasoning as string | null) ?? null,
          classification_warnings: Array.isArray(row.classification_warnings)
            ? (row.classification_warnings as string[])
            : null,
          receipt_count: (row.receipt_invoices ?? []).length,
          rule,
        };
      });
    },
  });

  const totals = useMemo(() => {
    // `captured` counts as needing a document: it means no document and no
    // eligibility decision yet, which is the same work the header is
    // summarising. Counting only needs_receipt would show "0 needs a document"
    // above a list full of expenses that need exactly that.
    const needsReceipt = expenses.filter(
      (e) =>
        e.lifecycle_status === "needs_receipt" ||
        e.lifecycle_status === "captured",
    );
    const pending = expenses.filter(
      (e) => e.lifecycle_status === "pending_review",
    );
    return {
      needsReceiptCount: needsReceipt.length,
      pendingCount: pending.length,
      pendingDollars: pending.reduce((s, e) => s + e.amount, 0),
    };
  }, [expenses]);

  /** Everything that has to re-read after a row changes. */
  const refresh = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ["bills"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  // Moved from /review's act(), behaviour preserved exactly.
  //
  // lifecycle_status is derived from the facets, so write the facet the
  // decision actually concerns. confirmed_at is set ONLY when the user makes
  // an audit-trail-quality determination (eligible/ineligible); "needs
  // receipt" is a documentation deferral, not an eligibility determination —
  // which is exactly why it does not set confirmed_at.
  const act = async (
    id: string,
    next: "eligible" | "ineligible" | "needs_receipt",
  ) => {
    setActingId(id);
    try {
      const now = new Date().toISOString();
      const update: Record<string, unknown> =
        next === "needs_receipt"
          ? { documentation_state: "none" }
          : { eligibility_state: next };
      if (next === "eligible" || next === "ineligible") {
        update.confirmed_at = now;
      }
      const { error } = await supabase
        .from("invoices")
        .update(update)
        .eq("id", id);
      if (error) throw error;

      // Refetch rather than dropping the row: the trigger decides whether this
      // expense still belongs in the queue (confirming an undocumented expense
      // leaves it in needs_receipt), and guessing here would show the user a
      // row vanishing only to return on the next load.
      await refresh();
      toast.success(
        next === "eligible"
          ? "Confirmed eligible. Logged with timestamp."
          : next === "ineligible"
            ? "Marked ineligible."
            : "Flagged as needing a receipt.",
      );
    } catch (err) {
      logError("Substantiate.act", err);
      toast.error("Could not save that decision. Please try again.");
    } finally {
      setActingId(null);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <AuthenticatedLayout>
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
          <p className="text-sm text-muted-foreground">
            Loading what needs substantiating…
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
          <Card>
            <CardContent className="p-10 text-center space-y-4">
              <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-xl font-semibold">You're all caught up</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Nothing is waiting on a document or a decision. When new
                expenses arrive from your bank or your uploads, they'll show up
                here.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-2 pt-2">
                <Button variant="outline" onClick={() => navigate("/expenses")}>
                  See all expenses
                </Button>
                <Button onClick={() => navigate("/substantiation")}>
                  Go to Reimburse
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
        <PageHeader
          title="Substantiate"
          description="Attach what proves each expense, then confirm whether it's eligible. Each confirmation is the timestamped record your Reimbursement Record cites."
        />

        <div className="flex flex-wrap gap-2 mt-4 mb-6 text-xs">
          {totals.needsReceiptCount > 0 && (
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
            >
              {totals.needsReceiptCount} needs a document
            </Badge>
          )}
          {totals.pendingCount > 0 && (
            <Badge
              variant="outline"
              className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800"
            >
              {totals.pendingCount} awaiting your decision ·{" "}
              {formatCurrency(totals.pendingDollars)}
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          {expenses.map((e) => {
            const tier = confidenceTier(e.classification_confidence);
            const ineligibleByRule =
              e.rule?.eligibility_status === "ineligible";
            const hasDoc = e.receipt_count > 0;
            // Confirmed eligible but still queued: the only thing left is a
            // document. Say so, rather than leaving the row looking untouched.
            const confirmedAwaitingDoc =
              e.eligibility_state === "eligible" && !hasDoc;

            return (
              <Card key={e.id}>
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{e.vendor}</p>
                      <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Money value={e.amount} />
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {formatDateOnly(e.date)}
                        </span>
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
                        <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                        <p className="text-sm font-medium">{e.rule.name}</p>
                        <Badge
                          variant="outline"
                          className={
                            e.rule.eligibility_status === "eligible"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 text-xs"
                              : e.rule.eligibility_status === "conditional"
                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 text-xs"
                                : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800 text-xs"
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
                        <p className="text-xs text-amber-700 dark:text-amber-400">
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
                          className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Documents ------------------------------------------- */}
                  <div className="rounded-md border bg-muted/20 p-3 space-y-2.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <Receipt className="h-3.5 w-3.5" />
                      {hasDoc
                        ? `${e.receipt_count} document${e.receipt_count === 1 ? "" : "s"} attached`
                        : "No document attached yet"}
                    </p>
                    {confirmedAwaitingDoc && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Confirmed eligible — it just needs a document before
                        it's ready to claim.
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setSubstantiateId(e.id)}
                      >
                        <Paperclip className="mr-2 h-3.5 w-3.5" />
                        {hasDoc ? "Documents & details" : "Attach a document"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => setAttachToId(e.id)}
                      >
                        <FolderOpen className="mr-2 h-3.5 w-3.5" />
                        Use a file already on file
                      </Button>
                    </div>
                  </div>

                  {/* Decision -------------------------------------------- */}
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      onClick={() => act(e.id, "eligible")}
                      disabled={
                        actingId === e.id ||
                        ineligibleByRule ||
                        e.eligibility_state === "eligible"
                      }
                      className="flex-1"
                    >
                      {actingId === e.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      {e.eligibility_state === "eligible"
                        ? "Confirmed eligible"
                        : "Confirm eligible"}
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
                  </div>

                  {ineligibleByRule && (
                    <p className="text-xs text-red-700 dark:text-red-400">
                      IRS Publication 502 lists this rule as ineligible. You can
                      override by marking it eligible with notes, but it won't
                      be defensible in an audit.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Attach + substantiate, both over the list so the queue is never lost. */}
      <SubstantiateDialog
        expenseId={substantiateId}
        open={substantiateId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSubstantiateId(null);
            void refresh();
          }
        }}
      />

      <AttachDocumentDialog
        invoiceId={attachToId ?? ""}
        open={attachToId !== null}
        onOpenChange={(open) => {
          if (!open) setAttachToId(null);
        }}
        onAttached={() => void refresh()}
      />
    </AuthenticatedLayout>
  );
}
