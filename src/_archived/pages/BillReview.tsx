import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { BillErrorCard } from "@/components/bills/BillErrorCard";
import { PriceBenchmarking } from "@/_archived/components/bills/PriceBenchmarking";
import { ProviderPerformanceCard } from "@/components/bills/ProviderPerformanceCard";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

export default function BillReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Fetch bill review data
  const { data: billReview, isLoading: isLoadingReview } = useQuery({
    queryKey: ["bill-review", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bill_reviews")
        .select(
          `
          *,
          invoices (
            id,
            vendor,
            amount,
            date,
            invoice_number
          )
        `,
        )
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch errors
  const { data: errors, isLoading: isLoadingErrors } = useQuery({
    queryKey: ["bill-errors", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bill_errors")
        .select("*")
        .eq("bill_review_id", id)
        .order("error_category", { ascending: true })
        .order("potential_savings", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch provider data
  const { data: providerData } = useQuery({
    queryKey: ["provider-for-bill", billReview?.invoices?.vendor],
    queryFn: async () => {
      if (!billReview?.invoices?.vendor) return null;
      const { data } = await supabase
        .from("providers")
        .select("*")
        .ilike("name", billReview.invoices.vendor)
        .maybeSingle();
      return data;
    },
    enabled: !!billReview?.invoices?.vendor,
  });

  const handleStartDispute = () => {
    if (!billReview?.invoice_id) return;
    navigate(`/bills/${billReview.invoice_id}/dispute`);
  };

  const handleMarkCorrect = async () => {
    if (!id) return;

    try {
      const { error } = await supabase
        .from("bill_reviews")
        .update({ review_status: "resolved" })
        .eq("id", id);

      if (error) throw error;

      toast.success("Bill marked as correct");
      navigate("/expenses");
    } catch (error) {
      logError("Error updating bill review", error);
      toast.error("Failed to update bill status");
    }
  };

  if (isLoadingReview || isLoadingErrors) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthenticatedLayout>
    );
  }

  if (!billReview) {
    return (
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 py-8">
          <Card className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Bill Review Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This bill review doesn't exist or you don't have access to it.
            </p>
            <Button onClick={() => navigate("/expenses")}>
              Back to Expenses
            </Button>
          </Card>
        </div>
      </AuthenticatedLayout>
    );
  }

  const invoice = billReview.invoices as any;
  const errorCount = errors?.length || 0;
  const savings = billReview.total_potential_savings || 0;

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate("/expenses")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Expenses
          </Button>
        </div>

        {/* Summary Card */}
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-2">Bill Review Results</h1>
                <p className="text-muted-foreground">
                  {invoice?.vendor} •{" "}
                  {invoice?.invoice_number || "No invoice #"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Bill Date: {new Date(invoice?.date).toLocaleDateString()}
                </p>
              </div>
              <Badge
                variant={errorCount > 0 ? "destructive" : "default"}
                className="text-lg px-4 py-2"
              >
                {errorCount} {errorCount === 1 ? "Issue" : "Issues"} Found
              </Badge>
            </div>

            {errorCount > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <span className="font-semibold">Total Issues</span>
                  </div>
                  <p className="text-3xl font-bold">{errorCount}</p>
                </div>

                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <span className="font-semibold">Potential Savings</span>
                  </div>
                  <p className="text-3xl font-bold text-green-600">
                    ${savings.toFixed(2)}
                  </p>
                </div>

                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <span className="font-semibold">Confidence Score</span>
                  </div>
                  <p className="text-3xl font-bold">
                    {((billReview.confidence_score || 0) * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Great News!</h3>
                <p className="text-muted-foreground">
                  We didn't find any obvious billing errors on this bill. Your
                  charges appear correct.
                </p>
              </div>
            )}

            {errorCount > 0 && (
              <div className="flex gap-3 pt-4">
                <Button size="lg" onClick={handleStartDispute}>
                  Start Dispute Process
                </Button>
                <Button size="lg" variant="outline" onClick={handleMarkCorrect}>
                  Mark as Correct Anyway
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Provider Performance */}
        {providerData && <ProviderPerformanceCard provider={providerData} />}

        {/* Price Benchmarking */}
        <PriceBenchmarking
          invoiceAmount={invoice?.amount || 0}
          category={invoice?.category}
        />

        {/* Error Cards */}
        {errors && errors.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Identified Issues</h2>
            {errors.map((error) => (
              <BillErrorCard key={error.id} error={error} />
            ))}
          </div>
        )}

        {/* Educational Content */}
        <Card className="p-6 bg-muted/50">
          <h3 className="text-lg font-semibold mb-3">What happens next?</h3>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              • <strong>Review the findings:</strong> Read through each
              identified issue carefully
            </p>
            <p>
              • <strong>Start a dispute:</strong> Use our guided dispute wizard
              to challenge incorrect charges
            </p>
            <p>
              • <strong>Track progress:</strong> Monitor your dispute status and
              communications in one place
            </p>
            <p>
              • <strong>Save money:</strong> Most successful disputes result in
              significant savings
            </p>
          </div>
        </Card>
      </div>
    </AuthenticatedLayout>
  );
}
