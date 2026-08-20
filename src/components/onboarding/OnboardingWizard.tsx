import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  PiggyBank,
  Upload,
  Inbox,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { analytics } from "@/lib/analytics";

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEPS = [
  {
    icon: PiggyBank,
    iconColor: "text-green-600",
    iconBg: "bg-green-500/10",
    title: "Your HSA is a wealth-building tool",
    description:
      "An HSA has a triple tax advantage: contributions are tax-deductible, growth is tax-free, and withdrawals for medical expenses are tax-free. Unlike an FSA, your balance rolls over forever.",
    highlight:
      "There's no time limit on reimbursements. Pay out-of-pocket today, let your HSA grow, and reimburse yourself years later — keeping all the investment gains.",
  },
  {
    icon: Sparkles,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-500/10",
    title: "Reclaim builds your paper trail",
    description:
      "To reimburse yourself from your HSA, you need documentation. Reclaim automatically creates and stores the records you need:",
    steps: [
      { icon: Inbox, label: "Classify bank transactions as medical or not" },
      { icon: Upload, label: "Attach the bill or receipt that proves it" },
      {
        icon: ShieldCheck,
        label: "Confirm it qualifies under IRS Publication 502",
      },
    ],
  },
  {
    icon: ShieldCheck,
    iconColor: "text-purple-600",
    iconBg: "bg-purple-500/10",
    title: "Claim when you're ready",
    description:
      "Whether that's tomorrow or a decade from now — when you want your money back, generate a reimbursement PDF with one click. It includes everything your HSA administrator needs.",
    highlight:
      "Start by uploading a bill or connecting your bank. Reclaim will guide you from there.",
  },
];

export function OnboardingWizard({
  open,
  onOpenChange,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { completeOnboarding } = useOnboarding();

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  // Wave 3 telemetry: distinguish shown / completed / skipped. shown fires
  // once per open. completed = user clicked "Get started" from the last screen.
  // skipped = user clicked "Skip" from any step before the last.
  const shownLogged = useRef(false);
  useEffect(() => {
    if (open && !shownLogged.current) {
      shownLogged.current = true;
      analytics.track({
        type: "onboarding_wizard_shown",
        metadata: { totalSteps: STEPS.length },
      });
    }
    if (!open) {
      shownLogged.current = false;
    }
  }, [open]);

  const handleComplete = (reason: "completed" | "skipped" = "completed") => {
    analytics.track({
      type:
        reason === "completed"
          ? "onboarding_wizard_completed"
          : "onboarding_wizard_skipped",
      metadata: { stepReached: step + 1, totalSteps: STEPS.length },
    });
    completeOnboarding();
    onOpenChange(false);
  };

  const handleGoToGuide = () => {
    analytics.track({
      type: "onboarding_wizard_completed",
      metadata: {
        stepReached: step + 1,
        totalSteps: STEPS.length,
        nextDestination: "guide",
      },
    });
    completeOnboarding();
    onOpenChange(false);
    navigate("/guide");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step
                  ? "w-8 bg-primary"
                  : i < step
                    ? "w-4 bg-primary/40"
                    : "w-4 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="px-6 pt-6 pb-2">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div
              className={`p-4 rounded-full ${current.iconBg || "bg-primary/10"}`}
            >
              <Icon
                className={`h-8 w-8 ${current.iconColor || "text-primary"}`}
              />
            </div>
          </div>

          {/* Title — serves as the accessible DialogTitle */}
          <DialogTitle className="text-xl font-bold text-center mb-3">
            {current.title}
          </DialogTitle>

          {/* Description */}
          <p className="text-muted-foreground text-center text-sm leading-relaxed">
            {current.description}
          </p>

          {/* Highlight box */}
          {current.highlight && (
            <div className="mt-4 rounded-lg bg-muted/50 border p-3">
              <p className="text-sm text-center font-medium">
                {current.highlight}
              </p>
            </div>
          )}

          {/* Step list (screen 2) */}
          {current.steps && (
            <div className="mt-4 space-y-3">
              {current.steps.map((s) => {
                const StepIcon = s.icon;
                return (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 rounded-lg border bg-background/50 px-4 py-3"
                  >
                    <StepIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Back
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleComplete("skipped")}
            >
              Skip
            </Button>
          )}

          <div className="flex items-center gap-2">
            {isLast && (
              <Button variant="outline" size="sm" onClick={handleGoToGuide}>
                Read full guide
              </Button>
            )}
            <Button
              size="sm"
              onClick={
                isLast
                  ? () => handleComplete("completed")
                  : () => setStep(step + 1)
              }
            >
              {isLast ? "Get started" : "Next"}
              {!isLast && <ArrowRight className="h-3.5 w-3.5 ml-1" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
