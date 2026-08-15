import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { ProgressStep } from "@/lib/userProgress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ProgressTrackerProps {
  steps: ProgressStep[];
}

export function ProgressTracker({ steps }: ProgressTrackerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const isDismissed =
      localStorage.getItem("progressTrackerDismissed") === "true";
    setDismissed(isDismissed);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("progressTrackerDismissed", "true");
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <Card>
      <CardHeader className="relative">
        <CardTitle className="text-lg pr-8">
          Your Health Savings Journey
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="absolute right-4 top-4 h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {steps.map((step, _index) => (
            <div key={step.id} className="flex items-center gap-4">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2",
                  step.status === "completed"
                    ? "bg-primary border-primary text-primary-foreground"
                    : step.status === "active"
                      ? "border-primary text-primary bg-primary/10"
                      : "border-muted text-muted-foreground bg-muted/20",
                )}
              >
                {step.status === "completed" ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-semibold">{step.id}</span>
                )}
              </div>

              <div className="flex-1">
                <p
                  className={cn(
                    "font-medium",
                    step.status === "completed"
                      ? "text-muted-foreground line-through"
                      : step.status === "active"
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {step.title}
                  {step.status === "completed" && " ✓"}
                  {step.status === "active" && " (in progress)"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
