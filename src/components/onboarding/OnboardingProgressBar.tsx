// The nudge bar for someone who skipped part of setup.
//
// Its two steps used to be "Upload Bill" then "Connect Accounts", in that
// order, which taught every new user the opposite of what Reclaim is: bank
// sync is the spine, and a bank connection is what makes the rest work. The
// order is now the spec's — connect, then the one fact that gates every claim.
//
// It also counted an HSA date OR a bank as one satisfied step, so connecting a
// bank silently marked the establishment date as handled. Those are separate
// questions and a missing date blocks reimbursement on its own.

import { useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, CalendarClock, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { analytics } from "@/lib/analytics";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";

interface OnboardingProgressBarProps {
  compact?: boolean;
}

const STEP_ROUTES: Record<string, string> = {
  bank: "/bank-accounts",
  hsaDate: "/settings",
};

export function OnboardingProgressBar({
  compact = false,
}: OnboardingProgressBarProps) {
  const navigate = useNavigate();
  const { isComplete, hasBank, hasHsaDate, isLoading } = useOnboardingStatus();

  const steps = [
    { key: "bank", label: "Connect a bank", icon: Link2, complete: hasBank },
    {
      key: "hsaDate",
      label: "HSA opened date",
      icon: CalendarClock,
      complete: hasHsaDate,
    },
  ];

  const completedSteps = steps.filter((s) => s.complete).length;
  const progress = (completedSteps / steps.length) * 100;

  // Wave 3 telemetry: fire `get_started_completed` exactly once per user when
  // all three steps land complete. localStorage guards re-firing across reloads.
  const COMPLETED_KEY = "getStartedCompletedTracked";
  const completedFiredRef = useRef(false);
  useEffect(() => {
    if (
      completedSteps === steps.length &&
      !completedFiredRef.current &&
      typeof window !== "undefined" &&
      window.localStorage.getItem(COMPLETED_KEY) !== "true"
    ) {
      completedFiredRef.current = true;
      window.localStorage.setItem(COMPLETED_KEY, "true");
      analytics.track({
        type: "get_started_completed",
        metadata: { totalSteps: steps.length },
      });
    }
  }, [completedSteps, steps.length]);

  // Nothing to nudge about until we know the answers, and nothing to nudge
  // about for someone still inside /welcome — they are being asked these very
  // questions on the screen in front of them.
  if (isLoading || isComplete !== true || completedSteps === steps.length) {
    return null;
  }

  const trackStepClick = (stepKey: string) => {
    analytics.track({
      type: "get_started_step_clicked",
      action: stepKey,
      metadata: { step: stepKey, completedBefore: completedSteps },
    });
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 rounded-full border border-accent/20">
        <span className="text-xs font-medium text-muted-foreground">
          Setup: {completedSteps}/{steps.length}
        </span>
        <Progress value={progress} className="w-16 h-1.5" />
      </div>
    );
  }

  return (
    <div className="bg-accent/5 border-b border-accent/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {completedSteps === 0 && "Get Started"}
              {completedSteps === 1 && "One More Step"}
            </span>

            <div className="hidden md:flex items-center gap-2">
              {steps.map((step, index) => (
                <div key={step.key} className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${
                      step.complete
                        ? "bg-accent/20 text-accent"
                        : "bg-muted text-muted-foreground cursor-pointer hover:bg-muted/80"
                    }`}
                    onClick={
                      !step.complete
                        ? () => {
                            trackStepClick(step.key);
                            navigate(STEP_ROUTES[step.key]);
                          }
                        : undefined
                    }
                    role={!step.complete ? "button" : undefined}
                  >
                    {step.complete ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <step.icon className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs font-medium">{step.label}</span>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`h-px w-6 ${step.complete ? "bg-accent" : "bg-muted"}`}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex md:hidden flex-1">
              <Progress value={progress} className="h-2" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground">
              {completedSteps}/{steps.length} complete
            </span>
            <span className="text-xs font-bold text-accent">
              {Math.round(progress)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
