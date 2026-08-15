import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, ArrowRight, Keyboard, Lightbulb } from "lucide-react";

interface OnboardingDialogProps {
  open: boolean;
  onComplete: () => void;
}

export function OnboardingDialog({ open, onComplete }: OnboardingDialogProps) {
  const [step, setStep] = useState(1);
  const totalSteps = 3;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <Dialog open={open} onOpenChange={onComplete}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Welcome to Review Queue! 🎉</DialogTitle>
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              Skip
            </Button>
          </div>
          <DialogDescription>
            Learn how to quickly categorize your transactions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="relative">
                  <Lightbulb className="h-16 w-16 text-primary animate-pulse" />
                  <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold">
                    AI
                  </div>
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-lg">Smart Suggestions</h3>
                <p className="text-sm text-muted-foreground">
                  We analyze each transaction and suggest whether it's a medical
                  expense based on:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 text-left max-w-sm mx-auto">
                  <li>• Vendor name matching (CVS, Walgreens, etc.)</li>
                  <li>• Previous expense bills</li>
                  <li>• Your past categorization choices</li>
                  <li>• Transaction amount and date patterns</li>
                </ul>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <Keyboard className="h-16 w-16 text-primary" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-lg">Keyboard Shortcuts</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Review transactions at lightning speed with keyboard
                  shortcuts:
                </p>
              </div>
              <div className="space-y-3 max-w-sm mx-auto">
                <Card className="p-3 flex items-center justify-between">
                  <span className="text-sm">Mark as Medical</span>
                  <kbd className="px-3 py-1.5 bg-muted rounded font-mono text-sm">
                    M
                  </kbd>
                </Card>
                <Card className="p-3 flex items-center justify-between">
                  <span className="text-sm">Not Medical</span>
                  <kbd className="px-3 py-1.5 bg-muted rounded font-mono text-sm">
                    N
                  </kbd>
                </Card>
                <Card className="p-3 flex items-center justify-between">
                  <span className="text-sm">Skip for Now</span>
                  <kbd className="px-3 py-1.5 bg-muted rounded font-mono text-sm">
                    S
                  </kbd>
                </Card>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <CheckCircle2 className="h-16 w-16 text-primary" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-lg">
                  It Gets Smarter Over Time
                </h3>
                <p className="text-sm text-muted-foreground">
                  Every time you categorize a transaction, our system learns:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 text-left max-w-sm mx-auto mt-4">
                  <li>• Which vendors you consider medical expenses</li>
                  <li>• Your specific categorization patterns</li>
                  <li>• Common amounts and dates for your medical spending</li>
                </ul>
                <p className="text-sm text-primary font-medium mt-4">
                  The more you use it, the better it gets!
                </p>
              </div>
            </div>
          )}

          {/* Progress Dots */}
          <div className="flex items-center justify-center gap-2 pt-4">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-all ${
                  i + 1 === step
                    ? "bg-primary w-6"
                    : i + 1 < step
                      ? "bg-primary/50"
                      : "bg-muted"
                }`}
              />
            ))}
          </div>

          <Button onClick={handleNext} className="w-full" size="lg">
            {step < totalSteps ? (
              <>
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            ) : (
              <>
                Get Started
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
