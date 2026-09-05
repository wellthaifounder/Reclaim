import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, DollarSign } from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { formatCurrency } from "@/lib/utils";

interface InsurancePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const INSURANCE_CARRIERS = [
  "Aetna",
  "Anthem/Blue Cross Blue Shield",
  "Cigna",
  "Humana",
  "Kaiser Permanente",
  "UnitedHealthcare",
  "Medicare",
  "Medicaid",
  "Other",
];

const PLAN_TYPES = [
  { value: "hmo", label: "HMO (Health Maintenance Organization)" },
  { value: "ppo", label: "PPO (Preferred Provider Organization)" },
  { value: "epo", label: "EPO (Exclusive Provider Organization)" },
  { value: "pos", label: "POS (Point of Service)" },
  { value: "hdhp", label: "HDHP (High Deductible Health Plan)" },
  { value: "other", label: "Other/Not Sure" },
];

export function InsurancePlanDialog({
  open,
  onOpenChange,
  onSuccess,
}: InsurancePlanDialogProps) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    carrier: "",
    planType: "",
    deductible: "",
    deductibleMet: "",
    outOfPocketMax: "",
    outOfPocketMet: "",
  });

  const handleSave = async () => {
    if (!formData.carrier || !formData.planType) {
      toast.error("Please select your insurance carrier and plan type");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in to save your insurance information");
        return;
      }

      // Save to profiles table (insurance_plan JSONB column)
      const { error } = await supabase
        .from("profiles")
        .update({
          insurance_plan: {
            carrier: formData.carrier,
            plan_type: formData.planType,
            deductible: formData.deductible
              ? parseFloat(formData.deductible)
              : null,
            deductible_met: formData.deductibleMet
              ? parseFloat(formData.deductibleMet)
              : null,
            out_of_pocket_max: formData.outOfPocketMax
              ? parseFloat(formData.outOfPocketMax)
              : null,
            out_of_pocket_met: formData.outOfPocketMet
              ? parseFloat(formData.outOfPocketMet)
              : null,
            updated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Insurance plan saved successfully!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      logError("Error saving insurance plan", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save insurance plan";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deductibleRemaining =
    formData.deductible && formData.deductibleMet
      ? Math.max(
          0,
          parseFloat(formData.deductible) - parseFloat(formData.deductibleMet),
        )
      : null;

  const oopRemaining =
    formData.outOfPocketMax && formData.outOfPocketMet
      ? Math.max(
          0,
          parseFloat(formData.outOfPocketMax) -
            parseFloat(formData.outOfPocketMet),
        )
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Add Your Insurance Plan
          </DialogTitle>
          <DialogDescription>
            Help us provide personalized cost estimates and identify savings
            opportunities. This information is encrypted and never shared.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Insurance Carrier */}
          <div className="space-y-2">
            <Label htmlFor="carrier">Insurance Carrier *</Label>
            <Select
              value={formData.carrier}
              onValueChange={(value) =>
                setFormData({ ...formData, carrier: value })
              }
            >
              <SelectTrigger id="carrier">
                <SelectValue placeholder="Select your insurance carrier" />
              </SelectTrigger>
              <SelectContent>
                {INSURANCE_CARRIERS.map((carrier) => (
                  <SelectItem key={carrier} value={carrier}>
                    {carrier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Plan Type */}
          <div className="space-y-2">
            <Label htmlFor="planType">Plan Type *</Label>
            <Select
              value={formData.planType}
              onValueChange={(value) =>
                setFormData({ ...formData, planType: value })
              }
            >
              <SelectTrigger id="planType">
                <SelectValue placeholder="Select your plan type" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.planType === "hdhp" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                HDHPs qualify for HSA benefits! Make sure to connect your HSA.
              </p>
            )}
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">
              Deductible & Out-of-Pocket (Optional)
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Adding this helps us show how close you are to meeting your
              deductible.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Annual Deductible */}
              <div className="space-y-2">
                <Label htmlFor="deductible">Annual Deductible</Label>
                <Input
                  id="deductible"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 3000"
                  value={formData.deductible}
                  onChange={(e) =>
                    setFormData({ ...formData, deductible: e.target.value })
                  }
                />
              </div>

              {/* Amount Met */}
              <div className="space-y-2">
                <Label htmlFor="deductibleMet">Amount Met So Far</Label>
                <Input
                  id="deductibleMet"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 1500"
                  value={formData.deductibleMet}
                  onChange={(e) =>
                    setFormData({ ...formData, deductibleMet: e.target.value })
                  }
                />
              </div>

              {/* Out-of-Pocket Max */}
              <div className="space-y-2">
                <Label htmlFor="outOfPocketMax">Out-of-Pocket Maximum</Label>
                <Input
                  id="outOfPocketMax"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 8000"
                  value={formData.outOfPocketMax}
                  onChange={(e) =>
                    setFormData({ ...formData, outOfPocketMax: e.target.value })
                  }
                />
              </div>

              {/* OOP Met */}
              <div className="space-y-2">
                <Label htmlFor="outOfPocketMet">Amount Met So Far</Label>
                <Input
                  id="outOfPocketMet"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 2000"
                  value={formData.outOfPocketMet}
                  onChange={(e) =>
                    setFormData({ ...formData, outOfPocketMet: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Progress Summary */}
            {(deductibleRemaining !== null || oopRemaining !== null) && (
              <div className="mt-4 p-3 bg-accent/10 rounded-lg space-y-2">
                {deductibleRemaining !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Deductible Remaining:
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(deductibleRemaining)}
                      {deductibleRemaining === 0 && " ✓"}
                    </span>
                  </div>
                )}
                {oopRemaining !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Out-of-Pocket Remaining:
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(oopRemaining)}
                      {oopRemaining === 0 && " ✓"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Skip for Now
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Insurance Plan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
