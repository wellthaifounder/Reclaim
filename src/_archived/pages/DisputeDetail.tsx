import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Building2, DollarSign, Calendar } from "lucide-react";
import { format } from "date-fns";
import { DisputeTimeline } from "@/components/bills/DisputeTimeline";
import { DisputeCommunicationLog } from "@/components/bills/DisputeCommunicationLog";
import { DisputeLetterGenerator } from "@/components/bills/DisputeLetterGenerator";
import { InsuranceVerification } from "@/components/bills/InsuranceVerification";
import { PriceBenchmarking } from "@/_archived/components/bills/PriceBenchmarking";
import { SettlementNegotiationTracker } from "@/_archived/components/bills/SettlementNegotiationTracker";
import { DisputeSuccessPredictor } from "@/components/bills/DisputeSuccessPredictor";
import { DisputeLoadingState } from "@/components/bills/DisputeLoadingState";
import { DisputeErrorState } from "@/components/bills/DisputeErrorState";

export default function DisputeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: dispute,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dispute", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bill_disputes")
        .select(
          `
          *,
          invoices (
            vendor,
            amount,
            date
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

  const { data: communications } = useQuery({
    queryKey: ["dispute-communications", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispute_communications")
        .select("*")
        .eq("dispute_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: errors } = useQuery({
    queryKey: ["dispute-errors", dispute?.bill_review_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bill_errors")
        .select("*")
        .eq("bill_review_id", dispute?.bill_review_id)
        .eq("status", "disputed");

      if (error) throw error;
      return data;
    },
    enabled: !!dispute?.bill_review_id,
  });

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto py-6 px-4 max-w-7xl">
        {isLoading ? (
          <DisputeLoadingState message="Loading dispute details..." />
        ) : error || !dispute ? (
          <DisputeErrorState
            title="Dispute Not Found"
            message="We couldn't find the dispute you're looking for. It may have been deleted or you may not have permission to view it."
            onRetry={() => refetch()}
            showHomeButton={true}
          />
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => navigate("/disputes")}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Disputes
              </Button>
            </div>

            {/* Title and Status */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-2">
                  {dispute.provider_name}
                </h1>
                <p className="text-muted-foreground">
                  Dispute created on{" "}
                  {format(new Date(dispute.created_at), "MMMM d, yyyy")}
                </p>
              </div>
              <Badge variant="outline" className="text-base px-4 py-2">
                {dispute.dispute_status.replace(/_/g, " ")}
              </Badge>
            </div>

            {/* Overview Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Provider
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold">{dispute.provider_name}</p>
                  {dispute.provider_contact_info &&
                    typeof dispute.provider_contact_info === "object" &&
                    "phone" in dispute.provider_contact_info && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {String(dispute.provider_contact_info.phone)}
                      </p>
                    )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Disputed Amount
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-orange-500">
                    ${dispute.disputed_amount.toFixed(2)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    of ${dispute.original_amount.toFixed(2)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Response Deadline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dispute.response_deadline ? (
                    <>
                      <p className="text-2xl font-bold">
                        {format(new Date(dispute.response_deadline), "MMM d")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(dispute.response_deadline), "yyyy")}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Not set</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Timeline */}
            <DisputeTimeline
              timeline={dispute.timeline as any[]}
              currentStatus={dispute.dispute_status}
            />

            {/* Price Benchmarking */}
            {dispute.invoices && (
              <PriceBenchmarking
                invoiceAmount={Number(dispute.original_amount)}
                category={(dispute.invoices as any).category}
              />
            )}

            {/* Insurance Verification */}
            <InsuranceVerification
              insuranceCompany={dispute.insurance_company || undefined}
              claimNumber={dispute.claim_number || undefined}
            />

            {/* Letter Generator */}
            {errors && errors.length > 0 && (
              <DisputeLetterGenerator dispute={dispute} errors={errors} />
            )}

            {/* Communication Log */}
            <DisputeCommunicationLog
              disputeId={dispute.id}
              communications={communications || []}
              onRefresh={refetch}
            />

            {/* Settlement Tracker and Success Predictor */}
            <div className="grid gap-6 md:grid-cols-2">
              <SettlementNegotiationTracker
                disputeId={dispute.id}
                originalAmount={Number(dispute.original_amount)}
                disputedAmount={Number(dispute.disputed_amount)}
              />

              <DisputeSuccessPredictor
                errorTypes={errors?.map((e) => e.error_type) || []}
                potentialSavings={Number(dispute.disputed_amount)}
                hasDocumentation={errors ? errors.length > 0 : false}
                hasInsuranceVerification={!!dispute.insurance_company}
              />
            </div>

            {/* Dispute Reason */}
            {dispute.dispute_reason && (
              <Card>
                <CardHeader>
                  <CardTitle>Dispute Reason</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">
                    {dispute.dispute_reason}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
