// The expense ledger — every expense, at every stage, in one place.
//
// This is the history view. /substantiate (labelled "Expenses") is a QUEUE: it
// deliberately shows only what still needs a document or a decision, so it can
// empty out and say "you're all caught up". That is the right behaviour for a
// queue and the wrong behaviour for a record — once an expense was claimed and
// reimbursed it vanished from the app entirely, which is a poor answer for a
// product whose whole promise is an audit trail you can still produce years
// later.
//
// It replaces the "To claim" tab that used to sit on the transaction list. That
// tab was the same list under a name that described only one of the six stages
// an expense passes through, embedded in the page for a different object
// (transactions). Same information, its own page, honestly named.
//
// The stage a row reports comes from lifecycle_status, the trigger-maintained
// column, with one override: claim_state 'not_reimbursable' wins, because an
// expense paid with the HSA card can never be claimed no matter where the
// lifecycle says it sits, and telling someone it is "ready to claim" is how a
// double-dip gets started.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Search,
  User,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Lifecycle = Database["public"]["Enums"]["invoice_lifecycle_status"];
type ClaimState = Database["public"]["Enums"]["expense_claim_state"];

interface LedgerExpense {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  date: string;
  patient_name: string | null;
  lifecycle_status: Lifecycle;
  claim_state: ClaimState;
  reimbursed_at: string | null;
  receipt_count: number;
}

// ── Stage presentation ────────────────────────────────────────────────────

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

// ── Filters ───────────────────────────────────────────────────────────────

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

type SortKey =
  "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "vendor_asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "amount_desc", label: "Largest amount" },
  { value: "amount_asc", label: "Smallest amount" },
  { value: "vendor_asc", label: "Provider A–Z" },
];

export default function AllExpenses() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const userId = user?.id;

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [docFilter, setDocFilter] = useState("any");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);

  // userId in the key and `enabled` on the query, both required: this reads an
  // auth.uid()-scoped table, so without them the first render races session
  // restore, caches an empty list, and the page says "no expenses" to someone
  // who has hundreds.
  const {
    data: expenses = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["all-expenses", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    meta: {
      errorMessage: "We had trouble loading your expenses. Please try again.",
    },
    queryFn: async (): Promise<LedgerExpense[]> => {
      // Columns enumerated, never `select *` -- the row this builds is handed
      // to the browser, and invoices carries fields (notes, reasoning,
      // insurance plan) that have no business leaving the database for a list
      // view that does not show them.
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, vendor, category, amount, date, patient_name,
           lifecycle_status, claim_state, reimbursed_at,
           receipt_invoices ( receipt_id )`,
        )
        .eq("user_id", userId!)
        .order("date", { ascending: false })
        .limit(1000);

      if (error) throw error;

      return (data ?? []).map((r) => ({
        id: r.id,
        vendor: r.vendor,
        category: r.category,
        amount: Number(r.amount),
        date: r.date,
        patient_name: r.patient_name,
        lifecycle_status: r.lifecycle_status,
        claim_state: r.claim_state,
        reimbursed_at: r.reimbursed_at,
        receipt_count: (r.receipt_invoices ?? []).length,
      }));
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const stage = STAGE_FILTERS.find((s) => s.value === stageFilter);

    const rows = expenses.filter((e) => {
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
      return true;
    });

    // Sorted on a copy: filter() already returns a new array, but the sort is
    // written to be safe if that ever changes.
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "date_asc":
          return a.date.localeCompare(b.date);
        case "amount_desc":
          return b.amount - a.amount;
        case "amount_asc":
          return a.amount - b.amount;
        case "vendor_asc":
          return a.vendor.localeCompare(b.vendor);
        case "date_desc":
        default:
          return b.date.localeCompare(a.date);
      }
    });
  }, [expenses, search, stageFilter, docFilter, sort]);

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
    search.trim() !== "" || stageFilter !== "all" || docFilter !== "any";

  const clearFilters = () => {
    setSearch("");
    setStageFilter("all");
    setDocFilter("any");
  };

  return (
    <ErrorBoundary
      fallbackTitle="Expenses Error"
      fallbackDescription="We couldn't load your expense history. Your data is safe. Please try again."
      onReset={() => void refetch()}
    >
      <AuthenticatedLayout>
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2 h-8 text-muted-foreground"
            onClick={() => navigate("/substantiate")}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Expenses
          </Button>

          <PageHeader
            title="All expenses"
            description="Every expense you've recorded, at every stage — including the ones already claimed and reimbursed."
            action={
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => navigate("/expenses/new")}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add manually
              </Button>
            }
          />

          {/* Summary of what is on screen. Same hairline strip as the
              transaction list, so the two lists read as one family. */}
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            <div className="bg-card px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Showing
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {visible.length}
              </p>
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

          {/* Toolbar. Search takes the whole row on a phone; the three selects
              share the row below it. */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Search provider, patient or category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search expenses"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger
                  className="sm:w-[190px]"
                  aria-label="Filter by stage"
                >
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
                  className="sm:w-[170px]"
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
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger
                  className="col-span-2 sm:w-[160px]"
                  aria-label="Sort expenses"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Says plainly that rows are being hidden, and offers the way back.
              A filtered list that looks like the whole list is how someone
              concludes an expense has gone missing. */}
          {filtersActive && !isLoading && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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

          {/* ── List ───────────────────────────────────────────────────── */}
          <div className="mt-4">
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
                  <Button variant="outline" onClick={() => void refetch()}>
                    Try again
                  </Button>
                </CardContent>
              </Card>
            ) : visible.length === 0 ? (
              <Card>
                <CardContent className="space-y-3 py-12 text-center">
                  <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                  {/* Two different empty states. "No expenses yet" and "your
                      filters hid them all" need different next actions, and
                      showing the first when it is really the second is how
                      someone concludes their records are gone. */}
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
                      <p className="font-medium">
                        No expenses match these filters
                      </p>
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
            ) : (
              <div className="space-y-2">
                {visible.map((e) => {
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
                              <CalendarDays
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              {formatDateOnly(e.date)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <User className="h-3 w-3" aria-hidden="true" />
                              {e.patient_name ?? "Self"}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-xs ${stage.className}`}
                            >
                              {stage.label}
                            </Badge>
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Paperclip
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              {e.receipt_count === 0
                                ? "No document"
                                : `${e.receipt_count} document${
                                    e.receipt_count === 1 ? "" : "s"
                                  }`}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                          <Money
                            value={e.amount}
                            className="text-base font-semibold tabular-nums"
                          />
                          {/* Reviewing the paperwork is the errand this page
                              exists for, so it is a control on the row rather
                              than a page-load away. stopPropagation because
                              the row itself opens the full expense. */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSubstantiateId(e.id);
                            }}
                          >
                            <Paperclip
                              className="mr-1 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            Documents
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <SubstantiateDialog
          expenseId={substantiateId}
          open={substantiateId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSubstantiateId(null);
              // Documents, amounts and eligibility can all have moved while the
              // dialog was open, so the row behind it is refreshed rather than
              // left showing a stale badge and document count.
              void refetch();
            }
          }}
        />
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
}
