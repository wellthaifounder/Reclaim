import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Star, Check, X, Eye, EyeOff } from "lucide-react";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";
import { logError } from "@/utils/errorHandler";

interface Review {
  id: string;
  user_id: string;
  rating: number;
  review_text: string;
  is_featured: boolean;
  moderation_status: string;
  moderated_by: string | null;
  moderated_at: string | null;
  moderation_notes: string | null;
  created_at: string;
}

export default function AdminReviews() {
  const navigate = useNavigate();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [moderationNotes, setModerationNotes] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      toast.error("Access denied. Admin privileges required.");
      navigate("/dashboard");
      return;
    }

    if (isAdmin) {
      fetchReviews();
    }
  }, [isAdmin, adminLoading, navigate]);

  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReviews(data || []);
    } catch (error) {
      logError("Error fetching reviews", error);
      toast.error("Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  const handleModeration = async (
    reviewId: string,
    action: "approved" | "rejected",
    notes?: string,
  ) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Update review moderation status
      const { error: reviewError } = await supabase
        .from("reviews")
        .update({
          moderation_status: action,
          moderated_by: user.id,
          moderated_at: new Date().toISOString(),
          moderation_notes: notes || null,
        })
        .eq("id", reviewId);

      if (reviewError) throw reviewError;

      // Log the moderation action
      const { error: logError } = await supabase
        .from("review_moderation_log")
        .insert({
          review_id: reviewId,
          admin_id: user.id,
          action,
          reason: notes || null,
        });

      if (logError) throw logError;

      toast.success(`Review ${action}`);
      fetchReviews();
    } catch (error) {
      logError("Error moderating review", error);
      toast.error("Failed to moderate review");
    }
  };

  const handleFeatureToggle = async (
    reviewId: string,
    currentlyFeatured: boolean,
  ) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("reviews")
        .update({ is_featured: !currentlyFeatured })
        .eq("id", reviewId);

      if (error) throw error;

      // Log the action
      await supabase.from("review_moderation_log").insert({
        review_id: reviewId,
        admin_id: user.id,
        action: currentlyFeatured ? "unfeatured" : "featured",
      });

      toast.success(
        currentlyFeatured ? "Review unfeatured" : "Review featured",
      );
      fetchReviews();
    } catch (error) {
      logError("Error toggling feature", error);
      toast.error("Failed to update feature status");
    }
  };

  const filteredReviews = reviews.filter(
    (review) => review.moderation_status === activeTab,
  );

  if (adminLoading || loading) {
    return <DashboardSkeleton />;
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Review Management</h1>
          <p className="text-muted-foreground mt-2">
            Moderate and manage user reviews for the homepage
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="pending">
              Pending (
              {reviews.filter((r) => r.moderation_status === "pending").length})
            </TabsTrigger>
            <TabsTrigger value="approved">
              Approved (
              {reviews.filter((r) => r.moderation_status === "approved").length}
              )
            </TabsTrigger>
            <TabsTrigger value="rejected">
              Rejected (
              {reviews.filter((r) => r.moderation_status === "rejected").length}
              )
            </TabsTrigger>
          </TabsList>

          {["pending", "approved", "rejected"].map((status) => (
            <TabsContent key={status} value={status} className="space-y-4">
              {filteredReviews.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">No {status} reviews</p>
                  </CardContent>
                </Card>
              ) : (
                filteredReviews.map((review) => (
                  <Card key={review.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-4 w-4 ${
                                    i < review.rating
                                      ? "fill-primary text-primary"
                                      : "text-muted-foreground"
                                  }`}
                                />
                              ))}
                            </div>
                            {review.is_featured && (
                              <Badge variant="secondary">Featured</Badge>
                            )}
                          </div>
                          <CardTitle className="text-lg">
                            {review.review_text}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Submitted{" "}
                            {new Date(review.created_at).toLocaleDateString()}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {review.moderation_notes && (
                        <div className="rounded-lg bg-muted p-3">
                          <p className="text-sm text-muted-foreground">
                            <strong>Moderation Notes:</strong>{" "}
                            {review.moderation_notes}
                          </p>
                        </div>
                      )}

                      {status === "pending" && (
                        <>
                          <Textarea
                            placeholder="Add moderation notes (optional)"
                            value={moderationNotes[review.id] || ""}
                            onChange={(e) =>
                              setModerationNotes({
                                ...moderationNotes,
                                [review.id]: e.target.value,
                              })
                            }
                            className="mb-3"
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={() =>
                                handleModeration(
                                  review.id,
                                  "approved",
                                  moderationNotes[review.id],
                                )
                              }
                              className="flex-1"
                            >
                              <Check className="h-4 w-4 mr-2" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() =>
                                handleModeration(
                                  review.id,
                                  "rejected",
                                  moderationNotes[review.id],
                                )
                              }
                              className="flex-1"
                            >
                              <X className="h-4 w-4 mr-2" />
                              Reject
                            </Button>
                          </div>
                        </>
                      )}

                      {status === "approved" && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            handleFeatureToggle(review.id, review.is_featured)
                          }
                          className="w-full"
                        >
                          {review.is_featured ? (
                            <>
                              <EyeOff className="h-4 w-4 mr-2" />
                              Remove from Featured
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4 mr-2" />
                              Add to Featured
                            </>
                          )}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
