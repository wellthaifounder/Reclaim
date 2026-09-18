// The All tab: every expense, at every stage.
//
// This is the record. The Substantiate tab beside it is a QUEUE — it holds
// only what still needs work, and empties out to say "you're all caught up".
// That is right for a queue and wrong for a record: once an expense was
// claimed and reimbursed it used to vanish from the app entirely, which is a
// poor answer from a product whose promise is an audit trail you can still
// produce years later.
//
// The stage a row reports comes from lifecycle_status, the trigger-maintained
// column, with one override: claim_state 'not_reimbursable' wins, because an
// expense paid with the HSA card can never be claimed no matter where the
// lifecycle sits, and telling someone it is "ready to claim" is how a
// double-dip gets started.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { ExpenseListControls } from "@/components/expense/ExpenseListControls";
import { MerchantGroupCard } from "@/components/transactions/MerchantGroupCard";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import {
  groupExpenses,
  matchesPatient,
  PATIENT_ALL,
  type ExpenseListViewState,
} from "@/lib/expenseListView";
import {
  CalendarDays,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  User,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Lifecycle = Database["public"]["Enums"]["invoice_lifecycle_status"];
type ClaimState = Database["public"]["Enums"]["expense_claim_state"];

export interface LedgerExpense {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  date: string;
  patient_id: string | null;
  patient_name: string | null;
  lifecycle_status: Lifecycle;
  claim_state: ClaimState;
  reimbursed_at: string | null;
  receipt_count: number;
}

interface Stage {
  label: string;
  className: string;
}

const STAGE_BY_LIFECYCLE: Record<Lifecycle, Stage> = {
  // 'captured' means no document and no eligibility call yet. From the user's
  // side that is the same errand as needs_receipt, so it reads the same way
  // here rather than exposing an internal distinction.
  captured: {
    label: "Needs a document",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  needs_receipt: {
    label: "Needs a document",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  pending_review: {
    label: "Awaiting your decision",
    className:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
  },
  eligible: {
    label: "Ready to claim",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
  ineligible: {
    label: "Not eligible",
    className:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  },
  submitted: {
    label: "In a claim",
    className:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800",
  },
  reimbursed: {
    label: "Reimbursed",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
};

const HSA_CARD_STAGE: Stage = {
  label: "Paid by HSA card",
  className: "bg-muted text-muted-foreground border-border",
};

function stageOf(e: LedgerExpense): Stage {
  if (e.claim_state === "not_reimbursable") return HSA_CARD_STAGE;
  return STAGE_BY_LIFECYCLE[e.lifecycle_status];
}

const STAGE_FILTERS: { value: string; label: string; match: Lifecycle[] }[] = [
  { value: "all", label: "Every stage", match: [] },
  {
    value: "needs_document",
    label: "Needs a document",
    match: ["captured", "needs_receipt"],
  },
  {
    value: "awaiting_decision",
    label: "Awaiting your decision",
    match: ["pending_review"],
  },
  { value: "ready", label: "Ready to claim", match: ["eligible"] },
  { value: "in_claim", label: "In a claim", match: ["submitted"] },
  { value: "reimbursed", label: "Reimbursed", match: ["reimbursed"] },
  { value: "ineligible", label: "Not eligible", match: ["ineligible"] },
];

interface Props {
  expenses: LedgerExpense[];
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => Promise<unknown>;
  view: ExpenseListViewState;
}

export function ExpenseLedger({
  expenses,
  isLoading,
  isError,
  onRefresh,
  view,
}: Props) {
  const navigate = useNavigate();
  const { members } = useFamilyRoster();
  const [stageFilter, setStageFilter] = useState("all");
  const [docFilter, setDocFilter] = useState("any");
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = view.search.trim().toLowerCase();
    const stage = STAGE_FILTERS.find((s) => s.value === stageFilter);

    return expenses.filter((e) => {
      if (
        q &&
        !e.vendor.toLowerCase().includes(q) &&
        !(e.patient_name ?? "").toLowerCase().includes(q) &&
        !e.category.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (stage && stage.match.length > 0) {
        if (!stage.match.includes(e.lifecycle_status)) return false;
      }
      if (docFilter === "with" && e.receipt_count === 0) return false;
      if (docFilter === "without" && e.receipt_count > 0) return false;
      return matchesPatient(e, view.patient, members);
    });
  }, [expenses, view.search, view.patient, members, stageFilter, docFilter]);

  const groups = useMemo(
    () => groupExpenses(visible, view.groupBy, view.sort),
    [visible, view.groupBy, view.sort],
  );

  // The summary describes what is on screen, so it moves with the filters
  // rather than quietly reporting a different population than the list under
  // it. The two claim figures come from claim_state, not from the amount
  // column: money already paid out and money still available are different
  // questions and only that column answers either of them.
  const totals = useMemo(() => {
    let total = 0;
    let ready = 0;
    let reimbursed = 0;
    for (const e of visible) {
      total += e.amount;
      if (e.lifecycle_status === "eligible" && e.claim_state === "unclaimed") {
        ready += e.amount;
      }
      if (
        e.claim_state === "reimbursed" ||
        e.claim_state === "reimbursed_externally"
      ) {
        reimbursed += e.amount;
      }
    }
    return { total, ready, reimbursed };
  }, [visible]);

  const filtersActive =
    view.search.trim() !== "" ||
    view.patient !== PATIENT_ALL ||
    stageFilter !== "all" ||
    docFilter !== "any";

  const clearFilters = () => {
    view.setSearch("");
    view.setPatient(PATIENT_ALL);
    setStageFilter("all");
    setDocFilter("any");
  };

  const renderRow = (e: LedgerExpense) => {
    const stage = stageOf(e);
    return (
      <Card
        key={e.id}
        role="button"
        tabIndex={0}
        className="cursor-pointer p-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => navigate(`/bills/${e.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(`/bills/${e.id}`);
          }
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{e.vendor}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" aria-hidden="true" />
                {formatDateOnly(e.date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden="true" />
                {e.patient_name ?? "Self"}
              </span>
              <Badge variant="outline" className={`text-xs ${stage.className}`}>
                {stage.label}
              </Badge>
              <span className="inline-flex items-center gap-1 text-xs">
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                {e.receipt_count === 0
                  ? "No document"
                  : `${e.receipt_count} document${e.receipt_count === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
            <Money
              value={e.amount}
              className="text-base font-semibold tabular-nums"
            />
            {/* Reviewing the paperwork is an errand this list exists for, so it
                is a control on the row rather than a page-load away.
                stopPropagation because the row itself opens the full expense. */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                setSubstantiateId(e.id);
              }}
            >
              <Paperclip className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Documents
            </Button>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary of what is on screen. Same hairline strip as the transaction
          list, so the two read as one family. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <div className="bg-card px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Showing
          </p>
          <p className="text-lg font-semibold tabular-nums">{visible.length}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Total
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(totals.total)}
          </p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Ready to claim
          </p>
          <p className="text-lg font-semibold tabular-nums text-primary">
            {formatCurrency(totals.ready)}
          </p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Reimbursed
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(totals.reimbursed)}
          </p>
        </div>
      </div>

      <ExpenseListControls
        search={view.search}
        onSearchChange={view.setSearch}
        patient={view.patient}
        onPatientChange={view.setPatient}
        groupBy={view.groupBy}
        onGroupByChange={view.setGroupBy}
        sort={view.sort}
        onSortChange={view.setSort}
        searchPlaceholder="Search provider, patient or category…"
      >
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="sm:w-[180px]" aria-label="Filter by stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={docFilter} onValueChange={setDocFilter}>
          <SelectTrigger
            className="sm:w-[165px]"
            aria-label="Filter by document"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any document</SelectItem>
            <SelectItem value="with">Has a document</SelectItem>
            <SelectItem value="without">No document yet</SelectItem>
          </SelectContent>
        </Select>
      </ExpenseListControls>

      {/* Says plainly that rows are being hidden, and offers the way back. A
          filtered list that looks like the whole list is how someone concludes
          an expense has gone missing. */}
      {filtersActive && !isLoading && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            Showing {visible.length} of {expenses.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        </div>
      )}

      {isLoading ? (
        <div
          className="flex min-h-[240px] items-center justify-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading your expenses…</span>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              We had trouble loading your expenses.
            </p>
            <Button variant="outline" onClick={() => void onRefresh()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            {/* Two different empty states. "No expenses yet" and "your filters
                hid them all" need different next actions, and showing the
                first when it is really the second is how someone concludes
                their records are gone. */}
            {expenses.length === 0 ? (
              <>
                <p className="font-medium">No expenses yet</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  An expense appears here when you mark a transaction as
                  medical, or when you add one by hand.
                </p>
                <div className="flex flex-col justify-center gap-2 pt-1 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => navigate("/transactions?tab=review")}
                  >
                    Categorize transactions
                  </Button>
                  <Button onClick={() => navigate("/expenses/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add an expense
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="font-medium">No expenses match these filters</p>
                <p className="text-sm text-muted-foreground">
                  You have {expenses.length} expense
                  {expenses.length === 1 ? "" : "s"} in total.
                </p>
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : view.groupBy === "none" ? (
        <div className="space-y-2">{groups[0]?.items.map(renderRow)}</div>
      ) : view.groupBy === "provider" ? (
        <div className="space-y-2">
          {groups.map((g) =>
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
            <div key={g.key} className="space-y-2">
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

      <SubstantiateDialog
        expenseId={substantiateId}
        open={substantiateId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSubstantiateId(null);
            // Documents, amounts and eligibility can all have moved while the
            // dialog was open, so the row behind it is refreshed rather than
            // left showing a stale badge and document count.
            void onRefresh();
          }
        }}
      />
    </div>
  );
}
