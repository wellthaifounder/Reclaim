import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star } from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { Card, CardContent } from "@/components/ui/card";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

interface Review {
  id: string;
  rating: number;
  review_text: string;
  created_at: string | null;
}

export const Testimonials = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation({
    threshold: 0.3,
  });
  const { ref: reviewsRef, isVisible: reviewsVisible } = useScrollAnimation({
    threshold: 0.1,
  });

  useEffect(() => {
    const fetchFeaturedReviews = async () => {
      try {
        const { data, error } = await supabase
          .from("reviews")
          .select("id, rating, review_text, created_at")
          .eq("is_featured", true)
          .eq("moderation_status", "approved")
          .order("created_at", { ascending: false })
          .limit(6);

        if (error) throw error;
        setReviews(data || []);
      } catch (error) {
        logError("Error fetching reviews", error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedReviews();
  }, []);

  if (loading || reviews.length === 0) return null;

  return (
    <section id="testimonials" className="py-20 lg:py-32 bg-gradient-soft">
      <div className="container mx-auto px-4">
        <div
          ref={headerRef}
          className={`mx-auto max-w-3xl text-center mb-12 scroll-fade-in ${headerVisible ? "visible" : ""}`}
        >
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl lg:text-5xl">
            What Our Users Say
          </h2>
          <p className="text-lg text-muted-foreground">
            Real feedback from people taking control of their healthcare costs
          </p>
        </div>

        <div
          ref={reviewsRef}
          className={`mx-auto max-w-6xl grid gap-6 md:grid-cols-2 lg:grid-cols-3 scroll-fade-in ${reviewsVisible ? "visible" : ""}`}
        >
          {reviews.map((review) => (
            <Card key={review.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-5 w-5 ${
                        i < review.rating
                          ? "fill-primary text-primary"
                          : "text-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">
                  "{review.review_text}"
                </p>
                {review.created_at && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {new Date(review.created_at).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
