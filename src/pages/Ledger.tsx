import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Search,
  Plus,
  CheckCircle2,
  Link2,
  AlertCircle,
  CircleDashed,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  FolderHeart,
  Sparkles,
  X,
  Upload,
  FileText,
} from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { logError } from "@/utils/errorHandler";
import { withQueryTimeout } from "@/lib/queryHelpers";
import { InboxQueue } from "@/components/ledger/InboxQueue";
import { CreateCareEventDialog } from "@/components/ledger/CreateCareEventDialog";
import { useClusterSuggestions } from "@/hooks/useClusterSuggestions";
import { useClaimableEvents } from "@/hooks/useClaimableEvents";
import { WorkflowGuideBanner } from "@/components/ledger/WorkflowGuideBanner";
import { FeatureTooltip } from "@/components/onboarding/FeatureTooltip";
import { useOnboarding } from "@/contexts/OnboardingContext";

interface LedgerEntry {
  invoice_id: string;
  user_id: string;
  vendor: string;
  category: string;
  service_date: string;
  invoice_date: string | null;
  billed_amount: number;
  total_amount: number | null;
  is_hsa_eligible: boolean;
  is_reimbursed: boolean;
  invoice_status: string;
  collection_id: string | null;
  invoice_number: string | null;
  invoice_notes: string | null;
  invoice_created_at: string;
  total_paid: number;
  paid_via_hsa: number;
  paid_via_oop: number;
  outstanding_balance: number;
  payment_count: number;
  has_auto_linked: boolean;
  latest_payment_date: string | null;
  linked_transaction_count: number;
  match_status: "auto_matched" | "manual" | "unmatched";
  care_event_title: string | null;
}

type StatusFilter =
  "all" | "unpaid" | "partially_paid" | "fully_paid" | "reimbursed";
type MatchFilter = "all" | "auto_matched" | "manual" | "unmatched";
type SortField =
  "service_date" | "billed_amount" | "outstanding_balance" | "vendor";
type SortDir = "asc" | "desc";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof CheckCircle2; color: string }
> = {
  fully_paid: {
    label: "Fully Paid",
    icon: CheckCircle2,
    color: "text-green-600 bg-green-500/10 border-green-500/20",
  },
  partially_paid: {
    label: "Partially Paid",
    icon: CircleDashed,
    color: "text-yellow-600 bg-yellow-500/10 border-yellow-500/20",
  },
  unpaid: {
    label: "Unpaid",
    icon: AlertCircle,
    color: "text-red-600 bg-red-500/10 border-red-500/20",
  },
  reimbursed: {
    label: "Reimbursed",
    icon: ShieldCheck,
    color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
  },
  draft: {
    label: "Draft",
    icon: CircleDashed,
    color: "text-gray-600 bg-gray-500/10 border-gray-500/20",
  },
};

const MATCH_CONFIG: Record<string, { label: string; color: string }> = {
  auto_matched: {
    label: "Auto-matched",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  manual: {
    label: "Linked",
    color: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  },
  unmatched: {
    label: "Unmatched",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  },
};

type CareEventFilter = "all" | "unassigned";

interface LedgerProps {
  /**
   * When true, render only the inner content without the AuthenticatedLayout
   * wrapper. Used by Bills.tsx (Wave 4 IA-collapse experiment) so the ledger
   * view can render inline under Bills' own AuthenticatedLayout without
   * double-wrapping nav / sidebar.
   */
  embedded?: boolean;
}

const Ledger = ({ embedded = false }: LedgerProps = {}) => {
  const Outer: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <>{children}</>
    : AuthenticatedLayout;
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [careEventFilter, setCareEventFilter] =
    useState<CareEventFilter>("all");
  const [hsaFilter, setHsaFilter] = useState(false);
  const [sortField, setSortField] = useState<SortField>("service_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set(),
  );
  const [careEventDialogOpen, setCareEventDialogOpen] = useState(false);
  const [clusterForDialog, setClusterForDialog] = useState<string[] | null>(
    null,
  );
  const [clusterDismissed, setClusterDismissed] = useState(false);
  const [claimableDismissed, setClaimableDismissed] = useState(false);

  const { hasSeenTransactions, markAsSeen } = useOnboarding();
  const [inboxTooltipDismissed, setInboxTooltipDismissed] = useState(false);

  const { data: clusters } = useClusterSuggestions();
  const { data: claimableEvents } = useClaimableEvents();

  const {
    data: entries,
    isLoading,
    isError,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ["ledger-entries"],
    queryFn: () =>
      withQueryTimeout(async (signal) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error("Not authenticated");

        // Query the view directly — RLS on invoices enforces access
        const { data, error } = await supabase
          .from("ledger_entries")
          .select(
            "invoice_id, user_id, vendor, category, service_date, invoice_date, billed_amount, total_amount, is_hsa_eligible, is_reimbursed, invoice_status, collection_id, invoice_number, invoice_notes, invoice_created_at, total_paid, paid_via_hsa, paid_via_oop, outstanding_balance, payment_count, has_auto_linked, latest_payment_date, linked_transaction_count, match_status, care_event_title",
          )
          .eq("user_id", user.id)
          .order("service_date", { ascending: false })
          .limit(500)
          .abortSignal(signal);

        if (error) {
          logError("Ledger query failed", error);
          throw error;
        }
        return (data || []) as LedgerEntry[];
      }),
    meta: {
      errorMessage: "We had trouble loading your ledger. Please try again.",
    },
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === "desc" ? (
      <ChevronDown className="h-3 w-3 inline ml-0.5" />
    ) : (
      <ChevronUp className="h-3 w-3 inline ml-0.5" />
    );
  };

  const filtered = useMemo(() => {
    if (!entries) return [];

    let result = entries.filter((e) => {
      if (
        searchTerm &&
        !e.vendor.toLowerCase().includes(searchTerm.toLowerCase())
      )
        return false;
      if (statusFilter !== "all" && e.invoice_status !== statusFilter)
        return false;
      if (matchFilter !== "all" && e.match_status !== matchFilter) return false;
      if (hsaFilter && !e.is_hsa_eligible) return false;
      if (careEventFilter === "unassigned" && e.collection_id !== null)
        return false;
      return true;
    });

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "service_date":
          cmp =
            new Date(a.service_date).getTime() -
            new Date(b.service_date).getTime();
          break;
        case "billed_amount":
          cmp = a.billed_amount - b.billed_amount;
          break;
        case "outstanding_balance":
          cmp = a.outstanding_balance - b.outstanding_balance;
          break;
        case "vendor":
          cmp = a.vendor.localeCompare(b.vendor);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [
    entries,
    searchTerm,
    statusFilter,
    matchFilter,
    hsaFilter,
    careEventFilter,
    sortField,
    sortDir,
  ]);

  // Summary stats
  const stats = useMemo(() => {
    if (!entries)
      return {
        total: 0,
        paid: 0,
        outstanding: 0,
        hsaClaimable: 0,
        reconciled: 0,
      };
    const total = entries.reduce((s, e) => s + e.billed_amount, 0);
    const paid = entries.reduce((s, e) => s + e.total_paid, 0);
    const outstanding = entries.reduce(
      (s, e) => s + Math.max(0, e.outstanding_balance),
      0,
    );
    const hsaClaimable = entries
      .filter((e) => e.is_hsa_eligible && !e.is_reimbursed)
      .reduce((s, e) => s + e.paid_via_oop, 0);
    const matched = entries.filter(
      (e) => e.match_status !== "unmatched",
    ).length;
    const reconciled =
      entries.length > 0 ? Math.round((matched / entries.length) * 100) : 100;
    return { total, paid, outstanding, hsaClaimable, reconciled };
  }, [entries]);

  const toggleEntrySelection = useCallback((invoiceId: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedEntries.size === filtered.length) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(filtered.map((e) => e.invoice_id)));
    }
  }, [filtered, selectedEntries.size]);

  const selectedForDialog = useMemo(
    () =>
      (clusterForDialog
        ? entries?.filter((e) => clusterForDialog.includes(e.invoice_id)) || []
        : filtered.filter((e) => selectedEntries.has(e.invoice_id))
      ).map((e) => ({
        invoice_id: e.invoice_id,
        vendor: e.vendor,
        category: e.category,
        service_date: e.service_date,
        billed_amount: e.billed_amount,
        care_event_title: e.care_event_title,
      })),
    [entries, filtered, selectedEntries, clusterForDialog],
  );

  // Workstream E1. This used to open a dialog that wrote a legacy
  // reimbursement request and marked every expense 'reimbursed' the moment the
  // PDF downloaded — before the claim had been sent, let alone paid. It now
  // hands the selection to the substantiation screen, which is the spec's
  // second entry point into the same flow ("multi-select from the expense
  // list, or the dedicated tab"), and which locks rather than settles.
  const startClaim = (invoiceIds: string[]) => {
    if (invoiceIds.length === 0) return;
    navigate("/substantiation", { state: { preselectInvoiceIds: invoiceIds } });
  };

  const selectedClaimableIds = useMemo(
    () =>
      filtered
        .filter(
          (e) =>
            selectedEntries.has(e.invoice_id) &&
            e.is_hsa_eligible &&
            !e.is_reimbursed,
        )
        .map((e) => e.invoice_id),
    [filtered, selectedEntries],
  );

  // Whether selected entries include any HSA-claimable bills
  const hasHSAClaimable = useMemo(
    () =>
      filtered.some(
        (e) =>
          selectedEntries.has(e.invoice_id) &&
          e.is_hsa_eligible &&
          !e.is_reimbursed,
      ),
    [filtered, selectedEntries],
  );

  if (isLoading) {
    return (
      <Outer>
        <div
          className="flex items-center justify-center min-h-[400px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading your ledger…</span>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Outer>
    );
  }

  if (isError) {
    return (
      <Outer>
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="rounded-lg border bg-card p-12 text-center space-y-3">
            <p className="text-muted-foreground">
              We had trouble loading your ledger.
            </p>
            <Button variant="outline" onClick={() => refetchEntries()}>
              Try again
            </Button>
          </div>
        </div>
      </Outer>
    );
  }

  return (
    <Outer>
      <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
        {/* Workflow Guide */}
        <WorkflowGuideBanner />

        {/* Attention Queue */}
        <FeatureTooltip
          title="Your Inbox"
          description="New transactions appear here for you to classify. Use keyboard shortcuts (J/K to navigate, M for medical, N for not) or click the buttons."
          show={!hasSeenTransactions && !inboxTooltipDismissed}
          onDismiss={() => {
            setInboxTooltipDismissed(true);
            markAsSeen("hasSeenTransactions");
          }}
        >
          <InboxQueue />
        </FeatureTooltip>

        {/* Cluster Suggestions Banner */}
        {!clusterDismissed && clusters && clusters.length > 0 && (
          <Card className="border-purple-500/20 bg-purple-500/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium">
                    Smart Grouping Suggestions
                  </span>
                  <Badge
                    variant="outline"
                    className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/20"
                  >
                    {clusters.length} cluster
                    {clusters.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setClusterDismissed(true)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-2">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.cluster_key}
                    className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <FolderHeart className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{cluster.vendor}</p>
                        <p className="text-xs text-muted-foreground">
                          {cluster.invoice_count} bills &middot; $
                          {cluster.total_amount.toFixed(2)} &middot;{" "}
                          {new Date(cluster.min_date).toLocaleDateString(
                            undefined,
                            { month: "short" },
                          )}
                          {cluster.min_date !== cluster.max_date &&
                            `–${new Date(cluster.max_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-purple-500/30 text-purple-600 hover:bg-purple-500/10"
                      onClick={() => {
                        setClusterForDialog(cluster.invoice_ids);
                        setCareEventDialogOpen(true);
                      }}
                    >
                      <FolderHeart className="h-3 w-3 mr-1" />
                      Create Care Event
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Claimable Care Events Banner */}
        {!claimableDismissed &&
          claimableEvents &&
          claimableEvents.length > 0 && (
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">
                      HSA Reimbursement Ready
                    </span>
                    <Badge
                      variant="outline"
                      className="text-xs bg-green-500/10 text-green-600 border-green-500/20"
                    >
                      {claimableEvents.length} care event
                      {claimableEvents.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setClaimableDismissed(true)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {claimableEvents.map((evt) => (
                    <div
                      key={evt.collection_id}
                      className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{evt.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {evt.invoice_count} eligible bill
                            {evt.invoice_count !== 1 ? "s" : ""} &middot; $
                            {evt.oop_claimable.toFixed(2)} claimable
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-green-500/30 text-green-600 hover:bg-green-500/10"
                        onClick={() => startClaim(evt.unreimbursed_invoice_ids)}
                      >
                        <ShieldCheck className="h-3 w-3 mr-1" />
                        Claim HSA
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Ledger</h1>
            <p className="text-muted-foreground text-sm">
              Unified view of all your medical expenses and payments
            </p>
          </div>
          <Button onClick={() => navigate("/bills/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Add Bill
          </Button>
        </div>

        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Billed</p>
            <p className="text-lg font-bold">
              $
              {stats.total.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Paid</p>
            <p className="text-lg font-bold text-green-600">
              $
              {stats.paid.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-lg font-bold text-red-600">
              $
              {stats.outstanding.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">HSA Claimable</p>
            <p className="text-lg font-bold text-purple-600">
              $
              {stats.hsaClaimable.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Reconciled</p>
            <p className="text-lg font-bold">{stats.reconciled}%</p>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by vendor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partially_paid">Partially Paid</SelectItem>
                  <SelectItem value="fully_paid">Fully Paid</SelectItem>
                  <SelectItem value="reimbursed">Reimbursed</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={matchFilter}
                onValueChange={(v) => setMatchFilter(v as MatchFilter)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Match Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Matches</SelectItem>
                  <SelectItem value="auto_matched">Auto-matched</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={careEventFilter}
                onValueChange={(v) => setCareEventFilter(v as CareEventFilter)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Care Event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Bills</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={hsaFilter ? "default" : "outline"}
                size="sm"
                onClick={() => setHsaFilter(!hsaFilter)}
              >
                HSA Eligible
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Ledger Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span>{filtered.length} entries</span>
              {searchTerm ||
              statusFilter !== "all" ||
              matchFilter !== "all" ||
              careEventFilter !== "all" ||
              hsaFilter ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                    setMatchFilter("all");
                    setCareEventFilter("all");
                    setHsaFilter(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchTerm ||
                statusFilter !== "all" ||
                matchFilter !== "all" ||
                careEventFilter !== "all" ||
                hsaFilter ? (
                  <>
                    <p className="mb-1">
                      No entries match your current filters
                    </p>
                    <p className="text-sm">
                      Try adjusting your filter settings.
                    </p>
                  </>
                ) : (
                  <>
                    <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="mb-1 font-medium text-foreground">
                      No bills yet
                    </p>
                    <p className="text-sm mb-4">
                      Upload your first bill to get started. Once you have
                      bills, you can classify transactions, group them into care
                      events, and claim HSA reimbursements.
                    </p>
                    <Button onClick={() => navigate("/bills/new")}>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Your First Bill
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="hidden md:grid grid-cols-[repeat(13,minmax(0,1fr))] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                  <div className="col-span-1 flex items-center">
                    <Checkbox
                      checked={
                        selectedEntries.size > 0 &&
                        selectedEntries.size === filtered.length
                      }
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </div>
                  <button
                    className="col-span-1 text-left hover:text-foreground"
                    onClick={() => toggleSort("service_date")}
                  >
                    Date <SortIcon field="service_date" />
                  </button>
                  <button
                    className="col-span-2 text-left hover:text-foreground"
                    onClick={() => toggleSort("vendor")}
                  >
                    Vendor <SortIcon field="vendor" />
                  </button>
                  <button
                    className="col-span-1 text-right hover:text-foreground"
                    onClick={() => toggleSort("billed_amount")}
                  >
                    Billed <SortIcon field="billed_amount" />
                  </button>
                  <div className="col-span-1 text-right">Paid</div>
                  <button
                    className="col-span-1 text-right hover:text-foreground"
                    onClick={() => toggleSort("outstanding_balance")}
                  >
                    Balance <SortIcon field="outstanding_balance" />
                  </button>
                  <div className="col-span-2 text-center">Status</div>
                  <div className="col-span-3 text-right">Tags</div>
                </div>

                {/* Table Rows */}
                <div className="divide-y">
                  {filtered.map((entry) => {
                    const statusCfg =
                      STATUS_CONFIG[entry.invoice_status] ||
                      STATUS_CONFIG.unpaid;
                    const matchCfg = MATCH_CONFIG[entry.match_status];
                    const StatusIcon = statusCfg.icon;

                    return (
                      <div
                        key={entry.invoice_id}
                        className={`grid grid-cols-1 md:grid-cols-[repeat(13,minmax(0,1fr))] gap-2 px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer items-center ${selectedEntries.has(entry.invoice_id) ? "bg-accent/40" : ""}`}
                        onClick={() => navigate(`/bills/${entry.invoice_id}`)}
                      >
                        {/* Checkbox */}
                        <div
                          className="col-span-1 flex items-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedEntries.has(entry.invoice_id)}
                            onCheckedChange={() =>
                              toggleEntrySelection(entry.invoice_id)
                            }
                            aria-label={`Select ${entry.vendor}`}
                          />
                        </div>

                        {/* Date */}
                        <div className="col-span-1 text-sm text-muted-foreground">
                          {new Date(entry.service_date).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </div>

                        {/* Vendor + Category */}
                        <div className="col-span-2">
                          <p className="font-medium text-sm truncate">
                            {entry.vendor}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.category}
                            {entry.care_event_title && (
                              <span className="ml-1 text-primary">
                                &middot; {entry.care_event_title}
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Billed */}
                        <div className="col-span-1 text-right text-sm font-medium">
                          ${entry.billed_amount.toFixed(2)}
                        </div>

                        {/* Paid */}
                        <div className="col-span-1 text-right text-sm text-green-600">
                          {entry.total_paid > 0
                            ? `$${entry.total_paid.toFixed(2)}`
                            : "—"}
                        </div>

                        {/* Outstanding */}
                        <div
                          className={`col-span-1 text-right text-sm ${entry.outstanding_balance > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                        >
                          {entry.outstanding_balance > 0
                            ? `$${entry.outstanding_balance.toFixed(2)}`
                            : "—"}
                        </div>

                        {/* Status */}
                        <div className="col-span-2 flex justify-center">
                          <Badge
                            variant="outline"
                            className={`text-xs ${statusCfg.color}`}
                          >
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusCfg.label}
                          </Badge>
                        </div>

                        {/* Tags */}
                        <div className="col-span-3 flex items-center gap-1 justify-end flex-wrap">
                          {matchCfg && entry.match_status !== "unmatched" && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${matchCfg.color}`}
                            >
                              {entry.match_status === "auto_matched" ? (
                                <Link2 className="h-3 w-3 mr-1" />
                              ) : null}
                              {matchCfg.label}
                            </Badge>
                          )}
                          {entry.match_status === "unmatched" &&
                            entry.invoice_status !== "fully_paid" && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${MATCH_CONFIG.unmatched.color}`}
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Unmatched
                              </Badge>
                            )}
                          {entry.is_hsa_eligible && (
                            <Badge variant="secondary" className="text-xs">
                              HSA
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Floating action bar */}
            {selectedEntries.size > 0 && (
              <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {selectedEntries.size} bill
                  {selectedEntries.size !== 1 ? "s" : ""} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setClusterForDialog(null);
                      setCareEventDialogOpen(true);
                    }}
                  >
                    <FolderHeart className="h-4 w-4 mr-2" />
                    Group as Care Event
                  </Button>
                  {hasHSAClaimable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-purple-500/30 text-purple-600 hover:bg-purple-500/10"
                      onClick={() => startClaim(selectedClaimableIds)}
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Claim HSA
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedEntries(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Care Event Dialog */}
      <CreateCareEventDialog
        open={careEventDialogOpen}
        onOpenChange={(open) => {
          setCareEventDialogOpen(open);
          if (!open) setClusterForDialog(null);
        }}
        entries={selectedForDialog}
        onSuccess={() => {
          setSelectedEntries(new Set());
          setClusterForDialog(null);
        }}
      />
    </Outer>
  );
};

export default Ledger;
