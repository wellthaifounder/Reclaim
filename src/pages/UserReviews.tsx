import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

const UserReviews = () => {
  const navigate = useNavigate();
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existingReview, setExistingReview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExistingReview = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) return;

        const { data, error } = await supabase
          .from("reviews")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (error && error.code !== "PGRST116") {
          throw error;
        }

        if (data) {
          setExistingReview(data);
          setRating(data.rating);
          setReviewText(data.review_text);
        }
      } catch (error) {
        logError("Error fetching review", error);
      } finally {
        setLoading(false);
      }
    };

    fetchExistingReview();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }

    if (reviewText.trim().length < 10) {
      toast.error("Please write at least 10 characters");
      return;
    }

    setSubmitting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (existingReview) {
        // Update existing review and reset moderation status
        const { error } = await supabase
          .from("reviews")
          .update({
            rating,
            review_text: reviewText,
            moderation_status: "pending",
            moderated_by: null,
            moderated_at: null,
            moderation_notes: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingReview.id);

        if (error) throw error;
        toast.success(
          "Review updated successfully! Our team will review it soon.",
        );
      } else {
        // Create new review (moderation_status defaults to 'pending')
        const { error } = await supabase.from("reviews").insert({
          user_id: user.id,
          rating,
          review_text: reviewText,
        });

        if (error) throw error;
        toast.success(
          "Review submitted successfully! Our team will review it soon.",
        );
      }

      // Refresh to show updated status
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      logError("Error submitting review", error);
      toast.error(error.message || "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Share Your Experience</h1>
          <p className="text-muted-foreground">
            Help others by sharing your experience with Wellth. Featured reviews
            appear on our homepage.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {existingReview ? "Update Your Review" : "Write a Review"}
            </CardTitle>
            <CardDescription>
              {existingReview?.moderation_status === "approved" &&
              existingReview?.is_featured ? (
                <span className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Your review is featured on our homepage!
                </span>
              ) : existingReview?.moderation_status === "approved" ? (
                <span className="text-green-600">
                  Your review has been approved
                </span>
              ) : existingReview?.moderation_status === "rejected" ? (
                <span className="text-destructive">
                  Your review was not approved.{" "}
                  {existingReview.moderation_notes
                    ? `Reason: ${existingReview.moderation_notes}`
                    : ""}
                </span>
              ) : existingReview ? (
                "Your review is under review by our team"
              ) : (
                "Tell us about your experience with Wellth"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Star Rating */}
              <div className="space-y-2">
                <Label>Rating</Label>
                <div className="flex items-center gap-2">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const starValue = i + 1;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setRating(starValue)}
                        onMouseEnter={() => setHoveredRating(starValue)}
                        onMouseLeave={() => setHoveredRating(0)}
                        className="transition-transform hover:scale-110"
                      >
                        <Star
                          className={`h-8 w-8 ${
                            starValue <= (hoveredRating || rating)
                              ? "fill-primary text-primary"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      </button>
                    );
                  })}
                  <span className="ml-2 text-sm text-muted-foreground">
                    {rating > 0 && `${rating} star${rating !== 1 ? "s" : ""}`}
                  </span>
                </div>
              </div>

              {/* Review Text */}
              <div className="space-y-2">
                <Label htmlFor="review">Your Review</Label>
                <Textarea
                  id="review"
                  placeholder="Share your experience with Wellth. What did you find most helpful? How has it impacted your healthcare spending?"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  rows={6}
                  className="resize-none"
                  required
                  minLength={10}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10 characters ({reviewText.length}/10)
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={
                    submitting || rating === 0 || reviewText.trim().length < 10
                  }
                  className="flex-1"
                >
                  {submitting
                    ? "Submitting..."
                    : existingReview
                      ? "Update Review"
                      : "Submit Review"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {existingReview && (
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h3 className="font-medium mb-2">About Featured Reviews</h3>
            <p className="text-sm text-muted-foreground">
              Our team reviews all submissions to ensure authenticity. Featured
              reviews are selected based on helpfulness and detail. All reviews
              are displayed with only the date and rating visible to protect
              your privacy.
            </p>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
};

export default UserReviews;
