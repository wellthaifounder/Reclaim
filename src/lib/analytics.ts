// Analytics tracking utility with support for 8 core KPIs
// Can be extended to integrate with Google Analytics, Mixpanel, PostHog, etc.

import { supabase } from "@/integrations/supabase/client";
import { safeLog, logError } from "@/utils/errorHandler";

type EventType =
  | "page_view"
  | "button_click"
  | "form_submit"
  | "report_view"
  | "bill_upload"
  | "dispute_filed"
  | "reimbursement_request"
  | "provider_search"
  | "cta_click"
  | "pricing_view"
  | "feature_view"
  | "testimonial_view"
  | "lead_capture"
  | "navigation_click"
  // Core KPI events
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "bill_analyzed"
  | "dispute_conversion"
  | "free_to_plus_conversion"
  | "user_retention_d7"
  | "user_retention_d30"
  | "time_to_first_value"
  // Cohort tracking events
  | "user_intent_selected"
  | "billing_cohort_action"
  | "hsa_cohort_action"
  // Wave 3 (2026-05) — onboarding consolidation experiment
  | "onboarding_wizard_shown"
  | "onboarding_wizard_completed"
  | "onboarding_wizard_skipped"
  | "get_started_step_clicked"
  | "get_started_completed"
  // Wave 4 (2026-05) — Bills/Ledger IA collapse experiment
  | "bills_view_selected";

interface AnalyticsEvent {
  type: EventType;
  page?: string;
  action?: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
}

class Analytics {
  constructor() {
    // Enable analytics in production
  }

  async track(event: AnalyticsEvent) {
    if (import.meta.env.DEV) {
      safeLog("Analytics (dev)", event);
    }

    // Store event in database for KPI analysis
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase.from("analytics_events").insert({
        user_id: user?.id || null,
        event_name: event.type,
        event_properties: {
          page: event.page,
          action: event.action,
          label: event.label,
          value: event.value,
          ...event.metadata,
        },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      // Don't throw - analytics failures shouldn't break the app
      logError("[Analytics Error]", error);
    }

    // Future: Send to external analytics service
    // Example: gtag('event', event.type, { ...event });
  }

  // KPI #1: Onboarding Completion Rate
  trackOnboardingStarted() {
    this.track({
      type: "onboarding_started",
      metadata: { timestamp: new Date().toISOString() },
    });
  }

  trackOnboardingStepCompleted(step: string, stepNumber: number) {
    this.track({
      type: "onboarding_step_completed",
      action: step,
      value: stepNumber,
      metadata: { timestamp: new Date().toISOString() },
    });
  }

  trackOnboardingCompleted(durationMs: number) {
    this.track({
      type: "onboarding_completed",
      value: durationMs,
      metadata: {
        timestamp: new Date().toISOString(),
        duration_seconds: Math.round(durationMs / 1000),
      },
    });
  }

  // KPI #2: Time to First Value (TTFV)
  trackTimeToFirstValue(
    actionType: "bill_analyzed" | "calculator_result",
    durationMs: number,
  ) {
    this.track({
      type: "time_to_first_value",
      action: actionType,
      value: durationMs,
      metadata: {
        duration_seconds: Math.round(durationMs / 1000),
        duration_minutes: Math.round(durationMs / 60000),
      },
    });
  }

  // KPI #3: Bill Analysis → Dispute Conversion
  trackDisputeConversion(billAmount: number, disputeAmount: number) {
    this.track({
      type: "dispute_conversion",
      value: disputeAmount,
      metadata: {
        bill_amount: billAmount,
        dispute_amount: disputeAmount,
        conversion_rate: (disputeAmount / billAmount) * 100,
      },
    });
  }

  // KPI #6: Free → Plus Conversion
  trackSubscriptionConversion(fromTier: string, toTier: string) {
    this.track({
      type: "free_to_plus_conversion",
      action: `${fromTier}_to_${toTier}`,
      metadata: {
        from_tier: fromTier,
        to_tier: toTier,
        timestamp: new Date().toISOString(),
      },
    });
  }

  pageView(page: string) {
    this.track({
      type: "page_view",
      page,
      metadata: {
        timestamp: new Date().toISOString(),
        path: window.location.pathname,
      },
    });
  }

  clickEvent(action: string, label?: string, value?: number) {
    this.track({
      type: "button_click",
      action,
      label,
      value,
      page: window.location.pathname,
    });
  }

  reportView(reportType: string) {
    this.track({
      type: "report_view",
      action: reportType,
      page: "/reports",
    });
  }

  billUpload(amount: number, category?: string) {
    this.track({
      type: "bill_upload",
      value: amount,
      metadata: { category },
    });
  }

  disputeFiled(amount: number, provider?: string) {
    this.track({
      type: "dispute_filed",
      value: amount,
      metadata: { provider },
    });
  }

  reimbursementRequest(amount: number) {
    this.track({
      type: "reimbursement_request",
      value: amount,
    });
  }

  providerSearch(query: string) {
    this.track({
      type: "provider_search",
      action: "search",
      label: query,
    });
  }

  ctaClick(ctaType: string, location: string) {
    this.track({
      type: "cta_click",
      action: ctaType,
      label: location,
      page: window.location.pathname,
    });
  }

  pricingView(plan: string) {
    this.track({
      type: "pricing_view",
      action: "view_plan",
      label: plan,
    });
  }

  featureView(feature: string) {
    this.track({
      type: "feature_view",
      action: "view_feature",
      label: feature,
    });
  }

  leadCapture(source: string) {
    this.track({
      type: "lead_capture",
      action: "email_submit",
      label: source,
    });
  }

  navigationClick(destination: string) {
    this.track({
      type: "navigation_click",
      action: "nav_click",
      label: destination,
    });
  }

  // Cohort Analytics - Bill Error Detection First Strategy
  trackUserIntent(intent: "billing" | "hsa" | "both") {
    this.track({
      type: "user_intent_selected",
      action: "select_intent",
      label: intent,
      metadata: {
        intent,
        timestamp: new Date().toISOString(),
      },
    });
  }

  trackBillingCohortAction(action: string, metadata?: Record<string, any>) {
    this.track({
      type: "billing_cohort_action",
      action,
      metadata: {
        cohort: "billing",
        ...metadata,
      },
    });
  }

  trackHSACohortAction(action: string, metadata?: Record<string, any>) {
    this.track({
      type: "hsa_cohort_action",
      action,
      metadata: {
        cohort: "hsa",
        ...metadata,
      },
    });
  }

  // Convenience method for tracking cohort-specific events
  trackEvent(eventName: string, properties?: Record<string, any>) {
    this.track({
      type: "button_click", // Generic type for custom events
      action: eventName,
      metadata: properties,
    });
  }
}

export const analytics = new Analytics();
