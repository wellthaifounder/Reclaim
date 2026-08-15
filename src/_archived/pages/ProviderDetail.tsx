import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  ArrowLeft,
  Building2,
  MapPin,
  Phone,
  Globe,
  TrendingUp,
  AlertTriangle,
  Star,
  DollarSign,
} from "lucide-react";
import { ProviderReviewForm } from "@/components/bills/ProviderReviewForm";
import { ProviderChargeComparison } from "@/components/bills/ProviderChargeComparison";
import { FairPricingScoreCard } from "@/components/bills/FairPricingScoreCard";
import { TransparencyScoreCard } from "@/components/bills/TransparencyScoreCard";
import { ProcedureCostInsights } from "@/_archived/components/bills/ProcedureCostInsights";

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: provider, isLoading } = useQuery({
    queryKey: ["provider", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reviews } = useQuery({
    queryKey: ["provider-reviews", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_reviews")
        .select("*")
        .eq("provider_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: chargeData } = useQuery({
    queryKey: ["provider-charges", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_charge_benchmarks")
        .select("*")
        .eq("provider_id", id)
        .order("sample_size", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: procedureInsights, isLoading: procedureLoading } = useQuery({
    queryKey: ["procedure-insights", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procedure_insights")
        .select("*")
        .eq("provider_id", id)
        .order("times_performed", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthenticatedLayout>
    );
  }

  if (!provider) {
    return (
      <AuthenticatedLayout>
        <div className="container mx-auto px-4 py-8">
          <Card className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">Provider Not Found</h2>
            <Button onClick={() => navigate("/providers")}>
              Back to Directory
            </Button>
          </Card>
        </div>
      </AuthenticatedLayout>
    );
  }

  const accuracyScore = Number(provider.billing_accuracy_score);
  const isHighAccuracy = accuracyScore >= 90;
  const isLowAccuracy = accuracyScore < 70;

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/providers")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Directory
          </Button>
        </div>

        {/* Provider Overview with Multi-dimensional Ratings */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-6">
              <div className="h-24 w-24 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-12 w-12 text-primary" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold mb-2">{provider.name}</h1>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                  {provider.provider_type && (
                    <Badge variant="outline">{provider.provider_type}</Badge>
                  )}
                  {provider.city && provider.state && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {provider.city}, {provider.state}
                    </span>
                  )}
                  {provider.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-4 w-4" />
                      {provider.phone}
                    </span>
                  )}
                  {provider.website && (
                    <a
                      href={provider.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      <Globe className="h-4 w-4" />
                      Website
                    </a>
                  )}
                </div>

                {/* Multi-dimensional Ratings */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium">Overall</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {Number(provider.overall_rating || 0).toFixed(1)}
                    </div>
                    <Progress
                      value={Number(provider.overall_rating || 0) * 20}
                      className="h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">
                        Cost Transparency
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {Number(provider.cost_transparency_score || 0).toFixed(1)}
                    </div>
                    <Progress
                      value={Number(provider.cost_transparency_score || 0) * 20}
                      className="h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium">
                        Billing Clarity
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {Number(provider.billing_clarity_score || 0).toFixed(1)}
                    </div>
                    <Progress
                      value={Number(provider.billing_clarity_score || 0) * 20}
                      className="h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-purple-600" />
                      <span className="text-sm font-medium">
                        Payment Flexibility
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {Number(provider.payment_flexibility_score || 0).toFixed(
                        1,
                      )}
                    </div>
                    <Progress
                      value={
                        Number(provider.payment_flexibility_score || 0) * 20
                      }
                      className="h-1.5"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Billing Accuracy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-3xl font-bold ${
                  isHighAccuracy
                    ? "text-green-600"
                    : isLowAccuracy
                      ? "text-red-600"
                      : "text-orange-600"
                }`}
              >
                {accuracyScore.toFixed(1)}%
              </div>
              <Progress value={accuracyScore} className="h-2 mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Average Bill Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                ${Number(provider.average_bill_amount).toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Dispute Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {provider.total_disputes_filed > 0
                  ? (
                      (provider.disputes_won / provider.total_disputes_filed) *
                      100
                    ).toFixed(1)
                  : "0"}
                %
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {provider.disputes_won} of {provider.total_disputes_filed}{" "}
                disputes won
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Overcharges
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">
                ${Number(provider.total_overcharges_found).toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Warning Banner for Low Accuracy */}
        {isLowAccuracy && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-destructive mt-1" />
                <div>
                  <h3 className="font-semibold text-destructive mb-1">
                    Low Billing Accuracy
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    This provider has a billing accuracy score below 70%.
                    Consider extra scrutiny when reviewing bills from this
                    provider.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="charges">Charge Comparison</TabsTrigger>
            <TabsTrigger value="reviews">
              Reviews ({reviews?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="history">Billing History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Transparency Score Card */}
            <TransparencyScoreCard
              transparencyScore={provider.transparency_score}
              billingAccuracyScore={provider.billing_accuracy_score}
              fairPricingScore={provider.fair_pricing_score}
              overallRating={provider.overall_rating}
            />

            {/* Fair Pricing Score Card */}
            <FairPricingScoreCard
              score={provider.fair_pricing_score}
              regionalPercentile={provider.regional_pricing_percentile}
              lastUpdated={provider.data_last_updated}
            />

            {/* Procedure Cost Insights */}
            <ProcedureCostInsights
              insights={procedureInsights || []}
              loading={procedureLoading}
            />

            {/* Performance Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Bills Analyzed
                    </p>
                    <p className="text-2xl font-bold">
                      {provider.total_bills_analyzed}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Disputes Filed
                    </p>
                    <p className="text-2xl font-bold">
                      {provider.total_disputes_filed}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Disputes Won
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {provider.disputes_won}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ratings */}
            {provider.overall_rating > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>User Ratings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Overall Rating</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={Number(provider.overall_rating) * 20}
                          className="w-24 h-2"
                        />
                        <span className="font-semibold">
                          {Number(provider.overall_rating).toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Cost Rating</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={Number(provider.cost_rating) * 20}
                          className="w-24 h-2"
                        />
                        <span className="font-semibold">
                          {Number(provider.cost_rating).toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Accuracy Rating</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={Number(provider.accuracy_rating) * 20}
                          className="w-24 h-2"
                        />
                        <span className="font-semibold">
                          {Number(provider.accuracy_rating).toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Response Rating</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={Number(provider.response_rating) * 20}
                          className="w-24 h-2"
                        />
                        <span className="font-semibold">
                          {Number(provider.response_rating).toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="charges" className="space-y-6 mt-6">
            <ProviderChargeComparison
              providerId={provider.id}
              chargeData={chargeData || []}
            />
          </TabsContent>

          <TabsContent value="reviews" className="space-y-6 mt-6">
            <ProviderReviewForm providerId={provider.id} />

            {reviews && reviews.length > 0 ? (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <Card key={review.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Star className="h-5 w-5 fill-yellow-500 text-yellow-500" />
                          <span className="font-semibold text-lg">
                            {review.overall_experience_rating}/5
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {new Date(review.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Billing Clarity
                          </p>
                          <p className="font-semibold">
                            {review.billing_clarity_rating}/5
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Cost Transparency
                          </p>
                          <p className="font-semibold">
                            {review.cost_transparency_rating}/5
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Payment Flexibility
                          </p>
                          <p className="font-semibold">
                            {review.payment_flexibility_rating}/5
                          </p>
                        </div>
                      </div>

                      {review.review_text && (
                        <p className="text-sm text-muted-foreground">
                          {review.review_text}
                        </p>
                      )}

                      {review.would_recommend !== null && (
                        <Badge
                          variant={
                            review.would_recommend ? "default" : "secondary"
                          }
                          className="mt-3"
                        >
                          {review.would_recommend
                            ? "Would Recommend"
                            : "Would Not Recommend"}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <Star className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Reviews Yet</h3>
                <p className="text-muted-foreground">
                  Be the first to review this provider
                </p>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Billing History Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-muted/30 rounded">
                    <span className="text-sm">Total Bills Analyzed</span>
                    <span className="font-semibold">
                      {provider.total_bills_analyzed}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-muted/30 rounded">
                    <span className="text-sm">Total Disputes</span>
                    <span className="font-semibold">
                      {provider.total_disputes_filed}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-500/10 rounded">
                    <span className="text-sm">Disputes Won</span>
                    <span className="font-semibold text-green-600">
                      {provider.disputes_won}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-red-500/10 rounded">
                    <span className="text-sm">Disputes Lost</span>
                    <span className="font-semibold text-red-600">
                      {provider.disputes_lost}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-orange-500/10 rounded">
                    <span className="text-sm">Total Overcharges Found</span>
                    <span className="font-semibold text-orange-600">
                      ${Number(provider.total_overcharges_found).toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AuthenticatedLayout>
  );
}
