import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Search,
  Loader2,
  FolderOpen,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { CollectionCard } from "@/components/collections/CollectionCard";
import { OrganizeWizard } from "@/components/collections/OrganizeWizard";
import { withQueryTimeout } from "@/lib/queryHelpers";

interface Collection {
  id: string;
  title: string;
  description: string | null;
  total_billed: number;
  total_paid: number;
  user_responsibility_override: number | null;
  hsa_eligible_amount: number;
  icon: string;
  color: string;
  status: "active" | "complete" | "needs_attention";
  created_at: string;
  invoice_count: number;
  document_count: number;
}

type StatusFilter = "all" | "active" | "complete" | "needs_attention";

export default function Collections() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showOrganizeWizard, setShowOrganizeWizard] = useState(false);

  // Check if user has unorganized invoices
  const { data: unorganizedCount } = useQuery({
    queryKey: ["unorganized-invoices-count"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return 0;

      const { count, error } = await supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("collection_id", null);

      if (error) return 0;
      return count || 0;
    },
  });

  // Fetch collections with counts
  const {
    data: collections,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: () =>
      withQueryTimeout(async (signal) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error("Not authenticated");

        const { data, error } = await supabase
          .from("collections")
          .select(
            `
            id, title, description, total_billed, total_paid,
            user_responsibility_override, hsa_eligible_amount,
            icon, color, status, created_at,
            invoices:invoices(count),
            receipts:receipts(count)
          `,
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .abortSignal(signal);

        if (error) throw error;

        return (data || []).map((c: any) => ({
          ...c,
          invoice_count: c.invoices?.[0]?.count || 0,
          document_count: c.receipts?.[0]?.count || 0,
        })) as Collection[];
      }),
    meta: {
      errorMessage:
        "We had trouble loading your care events. Please try again.",
    },
  });

  // Filter by search query
  const filteredCollections =
    collections?.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !c.title.toLowerCase().includes(query) &&
          !c.description?.toLowerCase().includes(query)
        )
          return false;
      }
      return true;
    }) || [];

  // Calculate totals
  const totals = collections?.reduce(
    (acc, c) => ({
      totalBilled: acc.totalBilled + c.total_billed,
      totalPaid: acc.totalPaid + c.total_paid,
      totalOutstanding:
        acc.totalOutstanding +
        (c.user_responsibility_override ?? c.total_billed - c.total_paid),
      hsaEligible: acc.hsaEligible + c.hsa_eligible_amount,
    }),
    { totalBilled: 0, totalPaid: 0, totalOutstanding: 0, hsaEligible: 0 },
  ) || { totalBilled: 0, totalPaid: 0, totalOutstanding: 0, hsaEligible: 0 };

  if (isLoading) {
    return (
      <AuthenticatedLayout>
        <div
          className="flex items-center justify-center min-h-[400px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading your care events…</span>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthenticatedLayout>
    );
  }

  if (isError) {
    return (
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="rounded-lg border bg-card p-12 text-center space-y-3">
            <p className="text-muted-foreground">
              We had trouble loading your care events.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Care Events</h1>
            <p className="text-muted-foreground">
              Group related bills, documents, and payments by episode of care
            </p>
          </div>
          <Button
            onClick={() => navigate("/collections/new")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New Care Event
          </Button>
        </div>

        {/* Organize Prompt */}
        {unorganizedCount && unorganizedCount > 0 && !showOrganizeWizard && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">
                    Organize Your Existing Bills
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    You have {unorganizedCount} bill
                    {unorganizedCount > 1 ? "s" : ""} not in any care event.
                    Organizing them helps you track expenses by episode of care.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      onClick={() => setShowOrganizeWizard(true)}
                    >
                      Organize Now
                    </Button>
                    <Button size="sm" variant="ghost">
                      Maybe Later
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Total Care Events
                </span>
              </div>
              <p className="text-2xl font-bold">{collections?.length || 0}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Total Billed
                </span>
              </div>
              <p className="text-2xl font-bold">
                ${totals.totalBilled.toFixed(2)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-muted-foreground">
                  Outstanding
                </span>
              </div>
              <p className="text-2xl font-bold text-destructive">
                ${totals.totalOutstanding.toFixed(2)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm text-muted-foreground">
                  HSA Eligible
                </span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                ${totals.hsaEligible.toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Search + Status Filter */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search care events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="needs_attention">Needs Attention</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Collections Grid */}
        {filteredCollections.length === 0 ? (
          <Card className="p-8 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Care Events Yet</h3>
            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
              Care events help you group related medical bills — like all visits
              to the same provider or a single episode of care.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => navigate("/ledger")}>
                Go to Ledger
              </Button>
              <Button onClick={() => navigate("/collections/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Create Care Event
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Tip: Select bills on the Ledger page and click "Group as Care
              Event" to create one.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCollections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                onClick={() => navigate(`/collections/${collection.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Organize Wizard Dialog */}
      {showOrganizeWizard && (
        <OrganizeWizard
          open={showOrganizeWizard}
          onOpenChange={setShowOrganizeWizard}
          onComplete={() => {
            setShowOrganizeWizard(false);
            refetch();
          }}
        />
      )}
    </AuthenticatedLayout>
  );
}
