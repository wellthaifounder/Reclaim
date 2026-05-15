import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { safeLog, logError } from "@/utils/errorHandler";

type SubscriptionTier = "free" | "plus" | "premium";

interface SubscriptionContextType {
  tier: SubscriptionTier;
  isSubscribed: boolean;
  subscriptionEnd: string | null;
  loading: boolean;
  refreshSubscription: () => Promise<void>;
  checkFeatureAccess: (requiredTier: SubscriptionTier) => boolean;
  createCheckoutSession: (tier: "plus" | "premium") => Promise<void>;
  openCustomerPortal: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(
  undefined,
);

const TIER_HIERARCHY = { free: 0, plus: 1, premium: 2 };

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Coalesce concurrent refresh calls — auth state events can fire several
  // times in rapid succession during initial load, causing duplicate
  // check-subscription invocations (each one is a CORS preflight + POST).
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refreshSubscription = async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const promise = (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setTier("free");
          setIsSubscribed(false);
          setSubscriptionEnd(null);
          setLoading(false);
          return;
        }

        const { data, error } =
          await supabase.functions.invoke("check-subscription");

        if (error) throw error;

        setTier(data.tier || "free");
        setIsSubscribed(data.subscribed || false);
        setSubscriptionEnd(data.subscription_end || null);
      } catch (error) {
        safeLog("Error checking subscription", error);
        setTier("free");
        setIsSubscribed(false);
      } finally {
        setLoading(false);
      }
    })();
    inFlightRef.current = promise;
    try {
      await promise;
    } finally {
      inFlightRef.current = null;
    }
  };

  const checkFeatureAccess = (requiredTier: SubscriptionTier): boolean => {
    return TIER_HIERARCHY[tier] >= TIER_HIERARCHY[requiredTier];
  };

  const createCheckoutSession = async (checkoutTier: "plus" | "premium") => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-checkout",
        {
          body: { tier: checkoutTier },
        },
      );

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      safeLog("Error creating checkout session", error);
      toast.error("Error", {
        description: "Failed to start checkout. Please try again.",
      });
    }
  };

  const openCustomerPortal = async () => {
    try {
      const { data, error } =
        await supabase.functions.invoke("customer-portal");

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      logError("Error opening customer portal", error);
      toast.error("Error", {
        description: "Failed to open billing portal. Please try again.",
      });
    }
  };

  useEffect(() => {
    refreshSubscription();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION fires on mount alongside the explicit refresh above —
      // skip it to avoid a duplicate check-subscription call.
      if (event === "INITIAL_SESSION") return;
      if (session) {
        setTimeout(() => refreshSubscription(), 0);
      } else {
        setTier("free");
        setIsSubscribed(false);
        setSubscriptionEnd(null);
      }
    });

    // Refresh subscription status every 60 seconds
    const interval = setInterval(refreshSubscription, 60000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return (
    <SubscriptionContext.Provider
      value={{
        tier,
        isSubscribed,
        subscriptionEnd,
        loading,
        refreshSubscription,
        checkFeatureAccess,
        createCheckoutSession,
        openCustomerPortal,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error(
      "useSubscription must be used within a SubscriptionProvider",
    );
  }
  return context;
};
