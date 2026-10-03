// The Substantiate tab: expenses that still need a document or an eligibility
// decision.
//
// Split out of the page when the ledger moved in beside it as a second tab.
// The queue's own rules are unchanged and worth restating, because they are
// the reason this list is trustworthy:
//
//   - **The queue is lifecycle_status, not a re-derivation.** `captured`,
//     `needs_receipt` and `pending_review` are precisely the states that mean
//     "step two is not done", and the column is maintained by
//     trg_invoices_sync_lifecycle from the three facets. Re-deriving readiness
//     from receipts + eligibility would be a second opinion that drifts.
//   - **Writes go to the facets**, never to lifecycle_status — that column is
//     derived and a direct write is overwritten.
//   - **confirmed_at is the audit-trail moat.** Medical Expense Records cite
//     that timestamp as the user's explicit eligibility determination, so it
//     is stamped only for a real determination, never for a deferral.
//   - **A row can stay after you confirm it.** Confirming an expense with no
//     document leaves it here in needs_receipt, correctly — it still needs a
//     receipt. So this refetches and lets the trigger decide what stays.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/ui/money";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { AttachDocumentDialog } from "@/components/documents/AttachDocumentDialog";
import { ExpenseListControls } from "@/components/expense/ExpenseListControls";
import { BulkSubstantiateBar } from "@/components/expense/BulkSubstantiateBar";
import { MerchantGroupCard } from "@/components/transactions/MerchantGroupCard";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { useClassifyExpense } from "@/hooks/useEligibilityGates";
import { useScanAttached } from "@/hooks/useDocumentScan";
import {
  CONFIRM_ANYWAY_PROMPT,
  useExpenseDecision,
} from "@/hooks/useExpenseDecision";
import type { QueueLifecycle } from "@/lib/expenseLifecycle";
import {
  groupExpenses,
  matchesPatient,
  PATIENT_ALL,
  type ExpenseListViewState,
} from "@/lib/expenseListView";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Receipt,
  Paperclip,
  AlertTriangle,
  Sparkles,
  CalendarDays,
  User,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

export interface QueueExpense {
  id: string;
  /** The name the person gave it; null shows the provider (S36). */
  title: string | null;
  vendor: string;
  amount: number;
  date: string;
  patient_id: string | null;
  patient_name: string | null;
  lifecycle_status: QueueLifecycle;
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

interface Props {
  expenses: QueueExpense[];
  isLoading: boolean;
  onRefresh: () => Promise<unknown>;
  view: ExpenseListViewState;
  /** Switches the page to the All tab — the empty state's way onward. */
  onGoToAll: () => void;
  /** Spec D16: a bulk "confirmed as healthcare" toast links here with the ids
   *  it just created, so the page can show only those. */
  filterIds: Set<string> | null;
  onClearIdFilter: () => void;
}

export function SubstantiateQueue({
  expenses,
  isLoading,
  onRefresh,
  view,
  onGoToAll,
  filterIds,
  onClearIdFilter,
}: Props) {
  const navigate = useNavigate();
  const { members } = useFamilyRoster();
  const classify = useClassifyExpense();
  const scanAttached = useScanAttached();
  const { decide } = useExpenseDecision();
  const [actingId, setActingId] = useState<string | null>(null);
  // The row waiting on "Confirm anyway?" (S32).
  const [askingId, setAskingId] = useState<string | null>(null);
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);
  // The order the person was looking at when they opened the dialog, frozen:
  // each decision refetches the queue and the rows move, but "3 of 12" and
  // "the next one" must keep meaning what they meant a moment ago (S31).
  const [walk, setWalk] = useState<string[] | null>(null);
  const [attachTo, setAttachTo] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const totals = useMemo(() => {
    // `captured` counts as needing a document: it means no document and no
    // eligibility decision yet, which is the same errand. Counting only
    // needs_receipt would show "0 needs a document" above a list full of them.
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

  // An id filter that matches nothing (stale ids, or everything in it was
  // already substantiated) falls back to the whole queue rather than showing
  // an empty page for a real backlog.
  const arrivals = filterIds
    ? expenses.filter((e) => filterIds.has(e.id))
    : null;
  const showingArrivals = !!arrivals && arrivals.length > 0;
  const scoped = showingArrivals ? arrivals! : expenses;

  const visible = useMemo(() => {
    const q = view.search.trim().toLowerCase();
    return scoped.filter((e) => {
      if (
        q &&
        !`${e.title ?? ""} ${e.vendor}`.toLowerCase().includes(q) &&
        !(e.patient_name ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return matchesPatient(e, view.patient, members);
    });
  }, [scoped, view.search, view.patient, members]);

  const groups = useMemo(
    () => groupExpenses(visible, view.groupBy, view.sort),
    [visible, view.groupBy, view.sort],
  );

  const selectedVisible = visible.filter((e) => selected.has(e.id));
  const allSelected =
    visible.length > 0 && selectedVisible.length === visible.length;

  const toggleOne = (id: string, next: boolean) =>
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });

  const toggleAll = (next: boolean) =>
    setSelected(next ? new Set(visible.map((e) => e.id)) : new Set());

  /**
   * One expense, one decision, through the same writes the dialog uses. The
   * IRS list saying no is judgement, so Confirm stays available with one extra
   * step (S32); a bulk action cannot take that step, which is why bulkDecide
   * still leaves those rows alone.
   */
  const act = async (
    id: string,
    next: "eligible" | "ineligible",
    acknowledgedList = false,
  ) => {
    setActingId(id);
    try {
      const outcome = await decide(id, next, { acknowledgedList });
      if (outcome === "needs_override") setAskingId(id);
      if (outcome === "done") {
        setAskingId(null);
        await onRefresh();
      }
    } finally {
      setActingId(null);
    }
  };

  const openDialog = (id: string) => {
    setWalk(groups.flatMap((g) => g.items.map((x) => x.id)));
    setSubstantiateId(id);
  };

  const closeDialog = () => {
    setSubstantiateId(null);
    setWalk(null);
    void onRefresh();
  };

  const walkIndex = walk && substantiateId ? walk.indexOf(substantiateId) : -1;
  const goToNext = () => {
    const next = walkIndex >= 0 ? walk![walkIndex + 1] : undefined;
    if (next) setSubstantiateId(next);
    else closeDialog();
  };

  const bulkDecide = async (next: "eligible" | "ineligible") => {
    // The per-row Confirm button is disabled when the matched Publication 502
    // rule says ineligible. Bulk must not become the way around that guard, so
    // those rows are skipped and the user is told how many and why — silently
    // overriding a cited rule is how an indefensible claim gets built.
    const blocked =
      next === "eligible"
        ? selectedVisible.filter(
            (e) => e.rule?.eligibility_status === "ineligible",
          )
        : [];
    const blockedIds = new Set(blocked.map((e) => e.id));
    const targets = selectedVisible
      .filter((e) => !blockedIds.has(e.id))
      .map((e) => e.id);

    if (targets.length === 0) {
      toast.error(
        "Publication 502 lists every expense you selected as ineligible. Open one to confirm it anyway.",
      );
      return;
    }

    setBulkBusy(true);
    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          eligibility_state: next,
          confirmed_at: new Date().toISOString(),
        })
        .in("id", targets);
      if (error) throw error;

      setSelected(new Set());
      await onRefresh();

      const done =
        next === "eligible"
          ? `Confirmed ${targets.length} as eligible. Each is logged with a timestamp.`
          : `Marked ${targets.length} as ineligible.`;
      toast.success(
        blocked.length > 0
          ? `${done} ${blocked.length} skipped — Publication 502 lists ${blocked.length === 1 ? "it" : "them"} as ineligible.`
          : done,
      );
    } catch (err) {
      logError("SubstantiateQueue.bulkDecide", err);
      toast.error("Could not save those decisions. Please try again.");
    } finally {
      setBulkBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center" role="status" aria-live="polite">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Loading what needs substantiating…
        </p>
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-xl font-semibold">You're all caught up</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Nothing is waiting on a document or a decision. When new expenses
            arrive from your bank or your uploads, they'll show up here.
          </p>
          {/* An empty queue is exactly when someone comes looking for an
              expense they have already dealt with, so the full history is the
              first thing offered. */}
          <div className="flex flex-col justify-center gap-2 pt-2 sm:flex-row">
            <Button variant="outline" onClick={onGoToAll}>
              See every expense
            </Button>
            <Button onClick={() => navigate("/substantiation")}>
              Go to Reimburse
            </Button>
          </div>
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/expenses/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add an expense manually
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderRow = (e: QueueExpense) => {
    const tier = confidenceTier(e.classification_confidence);
    const hasDoc = e.receipt_count > 0;
    // Confirmed eligible but still queued: the only thing left is a document.
    // Say so, rather than leaving the row looking untouched.
    const confirmedAwaitingDoc = e.eligibility_state === "eligible" && !hasDoc;

    return (
      <Card key={e.id}>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Checkbox
              className="mt-1 shrink-0"
              checked={selected.has(e.id)}
              onCheckedChange={(v) => toggleOne(e.id, v === true)}
              aria-label={`Select ${e.title || e.vendor}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{e.title || e.vendor}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <Money value={e.amount} />
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" aria-hidden="true" />
                  {formatDateOnly(e.date)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" aria-hidden="true" />
                  {e.patient_name ?? "Self"}
                </span>
              </p>
            </div>
            <Badge variant="outline" className={`shrink-0 ${tier.className}`}>
              {tier.label}
            </Badge>
          </div>

          {e.rule ? (
            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles
                  className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
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
            // Workstream D4 made this a request, never a promise: nothing
            // classifies an expense on its own, ever -- there is no queue or
            // timer behind it. The row used to say "Awaiting AI
            // classification," which reads as a wait about to end, when
            // really nothing had been asked yet. It also failed silently: a
            // network error here just left the spinner ending with nothing on
            // screen, which is why the toast on failure lives in the shared
            // hook rather than only here.
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                Not checked against IRS Publication 502 yet. You can still
                confirm or reject based on your own judgment.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => classify.mutate(e.id, { onSuccess: onRefresh })}
                disabled={classify.isPending && classify.variables === e.id}
              >
                {classify.isPending && classify.variables === e.id ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Check eligibility
              </Button>
            </div>
          )}

          {(e.classification_warnings?.length ?? 0) > 0 && (
            <ul className="space-y-1">
              {e.classification_warnings!.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
              {hasDoc
                ? `${e.receipt_count} document${e.receipt_count === 1 ? "" : "s"} attached`
                : "No document attached yet"}
            </p>
            {confirmedAwaitingDoc && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Confirmed eligible — it just needs a document before it's ready
                to claim.
              </p>
            )}
            {/* One button (S1). Reusing a document already on file is one of
                the dialog's own options now, so it is there wherever the
                dialog opens -- not a second button that exists only here. */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => openDialog(e.id)}
            >
              <Paperclip className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              {hasDoc ? "Documents & details" : "Attach a document"}
            </Button>
          </div>

          {askingId === e.id ? (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">{CONFIRM_ANYWAY_PROMPT}</p>
              <Button variant="outline" onClick={() => setAskingId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => act(e.id, "eligible", true)}
                disabled={actingId === e.id}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Confirm anyway
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                onClick={() => act(e.id, "eligible")}
                disabled={
                  actingId === e.id || e.eligibility_state === "eligible"
                }
                className="flex-1"
              >
                {actingId === e.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
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
                <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Not eligible
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
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

      {showingArrivals && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>
            Showing {arrivals!.length} you just confirmed as healthcare.
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={onClearIdFilter}
          >
            View all {expenses.length} in queue
          </Button>
        </div>
      )}

      <ExpenseListControls
        search={view.search}
        onSearchChange={view.setSearch}
        patient={view.patient}
        onPatientChange={view.setPatient}
        groupBy={view.groupBy}
        onGroupByChange={view.setGroupBy}
        sort={view.sort}
        onSortChange={view.setSort}
        searchPlaceholder="Search provider or patient…"
      />

      <BulkSubstantiateBar
        visible={visible.length > 0}
        selectedCount={selectedVisible.length}
        allSelected={allSelected}
        busy={bulkBusy}
        onToggleAll={toggleAll}
        onConfirmEligible={() => void bulkDecide("eligible")}
        onMarkIneligible={() => void bulkDecide("ineligible")}
        onAttachDocument={() => setAttachTo(selectedVisible.map((e) => e.id))}
        onClear={() => setSelected(new Set())}
      />

      {visible.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="font-medium">Nothing matches these filters</p>
            <p className="text-sm text-muted-foreground">
              {expenses.length} expense{expenses.length === 1 ? "" : "s"}{" "}
              {expenses.length === 1 ? "is" : "are"} waiting in this queue.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                view.setSearch("");
                view.setPatient(PATIENT_ALL);
              }}
            >
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : view.groupBy === "none" ? (
        <div className="space-y-3">{groups[0]?.items.map(renderRow)}</div>
      ) : view.groupBy === "provider" ? (
        <div className="space-y-3">
          {groups.map((g) =>
            // A single-expense provider is a card that hides one row behind a
            // click, so it renders as the row itself.
            g.count > 1 ? (
              <MerchantGroupCard
                key={g.key}
                label={g.label}
                count={g.count}
                total={g.total}
                earliest={g.earliest}
                latest={g.latest}
                itemNoun="expense"
              >
                {g.items.map(renderRow)}
              </MerchantGroupCard>
            ) : (
              g.items.map(renderRow)
            ),
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{g.label}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {g.count} · {formatCurrency(g.total)}
                </span>
              </div>
              {g.items.map(renderRow)}
            </div>
          ))}
        </div>
      )}

      {/* Both dialogs sit over the list so the queue is never lost. */}
      <SubstantiateDialog
        expenseId={substantiateId}
        open={substantiateId !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        queue={
          walkIndex >= 0
            ? {
                position: { current: walkIndex + 1, total: walk!.length },
                onDecided: () => {
                  void onRefresh();
                  goToNext();
                },
                onSkip: goToNext,
              }
            : undefined
        }
      />

      <AttachDocumentDialog
        invoiceIds={attachTo ?? []}
        open={attachTo !== null}
        onOpenChange={(open) => {
          if (!open) setAttachTo(null);
        }}
        onAttached={(receiptIds) => {
          // Each document is read once and fills every selected expense (S7).
          scanAttached(receiptIds, attachTo ?? []);
          setSelected(new Set());
          void onRefresh();
        }}
      />
    </div>
  );
}
