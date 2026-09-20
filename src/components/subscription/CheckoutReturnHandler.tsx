import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSubscription } from "@/contexts/SubscriptionContext";

/**
 * Meets the person on the way back from Stripe.
 *
 * create-checkout sends people back to /dashboard?subscription=success or
 * /settings?subscription=cancelled, and until now nothing read either. A
 * customer who had just paid landed on an ordinary dashboard that still said
 * "Free Plan" and gave no sign the payment had gone through -- the moment they
 * most need reassurance -- and one who backed out landed on Settings with no
 * acknowledgement at all.
 *
 * Renders nothing. Lives inside the router (the subscription provider sits
 * outside it and cannot read the URL), on every route, so it works wherever
 * Stripe returns to.
 */
export function CheckoutReturnHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshSubscription } = useSubscription();
  // React strict mode runs effects twice in development; without this the
  // toast would appear twice.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get("subscription");
    if (outcome !== "success" && outcome !== "cancelled") return;
    if (handled.current === location.key) return;
    handled.current = location.key;

    params.delete("subscription");
    const search = params.toString();

    if (outcome === "success") {
      toast.success("Payment received. Welcome aboard.", {
        description:
          "Your plan is being activated and can take a few seconds to show up.",
        duration: 8000,
      });
      // Stripe is the source of truth for the plan (check-subscription reads it
      // live), so one refresh now is normally enough. The second covers the
      // short lag before a brand-new subscription is visible to that lookup.
      void refreshSubscription();
      window.setTimeout(() => void refreshSubscription(), 4000);
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : "" },
        { replace: true },
      );
    } else {
      toast("Checkout cancelled", {
        description:
          "You haven't been charged. Pick a plan whenever you're ready.",
        duration: 6000,
      });
      // Back to the plan choice itself rather than the top of Settings.
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : "",
          hash: "#plan",
        },
        { replace: true },
      );
    }
  }, [location, navigate, refreshSubscription]);

  return null;
}
