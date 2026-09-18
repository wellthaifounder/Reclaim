// Reclaim — Expenses: step two of Categorize → Substantiate → Reimburse.
//
// Two tabs over one object. The nav calls this page "Expenses" (the object);
// the default tab is "Substantiate" (the verb), exactly as /transactions is
// named for transactions and opens on "Review". That pairing is deliberate:
// "substantiate" is too rare a word to spend a nav slot on, but it is the
// right word once you are standing on the page reading what the tab does.
//
// The two tabs were two pages until 2026-09-18. /substantiate was the queue,
// and the full expense history lived at /expenses/all — reachable only by a
// button on the queue, listed in no nav, and therefore invisible to anyone who
// had not already found it. Two pages about the same object, two queries, two
// row renderers, two places to fix the same bug. The old URL still redirects.
//
// **Why two queries rather than one.** The queue needs the classifier's
// confidence, reasoning, warnings and its matched Publication 502 rule — the
// evidence you want before deciding. The ledger needs none of that and spans
// every row the user has. Folding them into one query would pull the decision
// evidence for a thousand historical rows to render a stage badge. They stay
// separate, and every mutation invalidates both, which is what keeps them from
// disagreeing.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import {
  SubstantiateQueue,
  type QueueExpense,
} from "@/components/expense/SubstantiateQueue";
import { SUBSTANTIATE_STATES } from "@/lib/expenseLifecycle";
import {
  ExpenseLedger,
  type LedgerExpense,
} from "@/components/expense/ExpenseLedger";
import {
  DEFAULT_EXPENSE_GROUP_BY,
  DEFAULT_EXPENSE_SORT,
  PATIENT_ALL,
  type ExpenseGroupBy,
  type ExpenseListViewState,
  type ExpenseSortOrder,
} from "@/lib/expenseListView";

type Tab = "substantiate" | "all";

export default function Substantiate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthUser();
  const userId = user?.id;

  const tab: Tab = searchParams.get("tab") === "all" ? "all" : "substantiate";

  // The history is not fetched until the tab that shows it is opened, so the
  // common case — arriving from the nav to work the queue — costs one query.
  const [allEverOpened, setAllEverOpened] = useState(tab === "all");

  const setTab = (next: string) => {
    if (next === "all") setAllEverOpened(true);
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === "all") out.set("tab", "all");
        else out.delete("tab");
        return out;
      },
      { replace: true },
    );
  };

  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState(PATIENT_ALL);
  const [groupBy, setGroupBy] = useState<ExpenseGroupBy>(
    DEFAULT_EXPENSE_GROUP_BY,
  );
  const [sort, setSort] = useState<ExpenseSortOrder>(DEFAULT_EXPENSE_SORT);

  const view: ExpenseListViewState = {
    search,
    setSearch,
    patient,
    setPatient,
    groupBy,
    setGroupBy,
    sort,
    setSort,
  };

  const filterIds = useMemo(() => {
    const raw = searchParams.get("ids");
    return raw ? new Set(raw.split(",").filter(Boolean)) : null;
  }, [searchParams]);

  const clearIdFilter = () =>
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete("ids");
        return out;
      },
      { replace: true },
    );

  const queueQuery = useQuery({
    queryKey: ["substantiate-queue", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<QueueExpense[]> => {
      // receipt_count comes from receipt_invoices, not a receipts embed --
      // attachment lives in the join table, so a document attached through the
      // multi-attach path still needs to count here.
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, vendor, amount, date, patient_id, patient_name,
           lifecycle_status, eligibility_state, documentation_state, confirmed_at,
           classification_confidence, classification_reasoning,
           classification_warnings,
           rule:pub_502_rules!eligibility_basis_rule_id ( id, name, eligibility_status, section_ref, conditions ),
           receipt_invoices ( receipt_id )`,
        )
        .eq("user_id", userId!)
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
          patient_id: (row.patient_id as string | null) ?? null,
          patient_name: (row.patient_name as string | null) ?? null,
          lifecycle_status:
            row.lifecycle_status as QueueExpense["lifecycle_status"],
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

  // userId in the key and `enabled` on the query, both required: this reads an
  // auth.uid()-scoped table, so without them the first render races session
  // restore, caches an empty list, and the page says "no expenses" to someone
  // who has hundreds.
  const ledgerQuery = useQuery({
    queryKey: ["all-expenses", userId],
    enabled: !!userId && allEverOpened,
    staleTime: 5 * 60 * 1000,
    meta: {
      errorMessage: "We had trouble loading your expenses. Please try again.",
    },
    queryFn: async (): Promise<LedgerExpense[]> => {
      // Columns enumerated, never `select *` -- invoices carries fields
      // (notes, reasoning, insurance plan) that have no business leaving the
      // database for a list view that does not show them.
      const { data, error } = await supabase
        .from("invoices")
        .select(
          `id, vendor, category, amount, date, patient_id, patient_name,
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
        patient_id: r.patient_id,
        patient_name: r.patient_name,
        lifecycle_status: r.lifecycle_status,
        claim_state: r.claim_state,
        reimbursed_at: r.reimbursed_at,
        receipt_count: (r.receipt_invoices ?? []).length,
      }));
    },
  });

  /** Everything that has to re-read after a row changes, from either tab. */
  const refreshFrom = async (origin: "queue" | "ledger") => {
    await (origin === "queue" ? queueQuery.refetch() : ledgerQuery.refetch());
    // The other tab is marked stale rather than refetched: it may not be
    // mounted, and a decision made here changes which rows belong on it.
    queryClient.invalidateQueries({
      queryKey: origin === "queue" ? ["all-expenses"] : ["substantiate-queue"],
    });
    queryClient.invalidateQueries({ queryKey: ["bills"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["attention-items"] });
  };

  const queueCount = queueQuery.data?.length ?? 0;

  return (
    <ErrorBoundary
      fallbackTitle="Expenses Error"
      fallbackDescription="We couldn't load your expenses. Your data is safe. Please try again."
      onReset={() => void queueQuery.refetch()}
    >
      <AuthenticatedLayout>
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <PageHeader
                title="Expenses"
                description="Attach what proves each expense, then confirm whether it's eligible. Each confirmation is the timestamped record your Medical Expense Record cites."
              />
            </div>
            {/* The only way to record a cash payment or mileage, neither of
                which ever appears in a bank feed, and what it creates is an
                expense — this page's object. */}
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => navigate("/expenses/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add manually
            </Button>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-6">
            <TabsList className="mb-6 flex h-auto max-w-full flex-wrap justify-start">
              <TabsTrigger value="substantiate">
                Substantiate
                {queueCount > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {queueCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>

            <TabsContent value="substantiate">
              <SubstantiateQueue
                expenses={queueQuery.data ?? []}
                isLoading={queueQuery.isLoading}
                onRefresh={() => refreshFrom("queue")}
                view={view}
                onGoToAll={() => setTab("all")}
                filterIds={filterIds}
                onClearIdFilter={clearIdFilter}
              />
            </TabsContent>

            <TabsContent value="all">
              <ExpenseLedger
                expenses={ledgerQuery.data ?? []}
                isLoading={ledgerQuery.isLoading}
                isError={ledgerQuery.isError}
                onRefresh={() => refreshFrom("ledger")}
                view={view}
              />
            </TabsContent>
          </Tabs>
        </div>
      </AuthenticatedLayout>
    </ErrorBoundary>
  );
}
