// Workstream D3 — the eligibility gates, reported.
//
// Replaces TimingGateNotice, which showed Gate 1 alone. Both gates have to
// appear together: an expense can fail timing AND dependency, and showing only
// the fixable one sends the user off to answer a tax question that will not
// change the answer.
//
// Both gates are computed and REPORTED, never asked. Whether care predates the
// HSA, and whether the patient is a tax dependent, are facts already recorded
// elsewhere. The only input here is the date of care, because it is the one
// variable a bank feed cannot know.

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  HelpCircle,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/utils/errorHandler";
import {
  useEligibilityGates,
  type EligibilityGate,
} from "@/hooks/useEligibilityGates";
import { useTimingGate } from "@/hooks/useHSAEligibility";

function GateRow({ gate }: { gate: EligibilityGate }) {
  const Icon =
    gate.status === "ineligible"
      ? CircleAlert
      : gate.status === "eligible"
        ? CircleCheck
        : HelpCircle;

  return (
    <div className="flex items-start gap-2">
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
          gate.status === "ineligible"
            ? "text-destructive"
            : gate.status === "eligible"
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-500"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 text-sm">
        <span>{gate.reason}</span>
        {/* Only the dependency gate has somewhere useful to go. The timing
            gate has no remedy, so offering a link would imply one exists. */}
        {gate.gate === "dependency" && gate.status !== "eligible" && (
          <Link
            to="/settings"
            className="ml-1 underline underline-offset-2 hover:opacity-80"
          >
            <Users className="mr-0.5 inline h-3 w-3" />
            Update your family list
          </Link>
        )}
      </div>
    </div>
  );
}

export function EligibilityGates({
  invoiceId,
  serviceDate,
}: {
  invoiceId: string;
  /** invoices.service_date — null when we're falling back to the payment date. */
  serviceDate: string | null;
}) {
  const { gates, primaryBlocker, isLoading } = useEligibilityGates(invoiceId);
  // Only for `uses_payment_date`, which decides whether to offer the date
  // editor. The verdict itself comes from the combined read above.
  const { gate: timing } = useTimingGate(invoiceId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(serviceDate ?? "");
  const [saving, setSaving] = useState(false);

  if (isLoading || gates.length === 0) return null;

  const saveServiceDate = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ service_date: draft })
        .eq("id", invoiceId);
      if (error) throw error;

      // A database trigger re-runs BOTH gates on this row, so the verdict can
      // flip in either direction, and the blocking reason can change from one
      // gate to the other.
      queryClient.invalidateQueries({
        queryKey: ["eligibility-gates", invoiceId],
      });
      queryClient.invalidateQueries({ queryKey: ["timing-gate", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setEditing(false);
      toast.success("Date of care saved.");
    } catch (error) {
      logError("Saving date of service failed", error);
      toast.error("Couldn't save that date. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const usesPaymentDate = timing?.uses_payment_date ?? false;

  return (
    <Alert variant={primaryBlocker ? "destructive" : "default"}>
      {primaryBlocker ? (
        <CircleAlert className="h-4 w-4" />
      ) : (
        <CircleCheck className="h-4 w-4" />
      )}
      <AlertDescription className="space-y-2">
        {primaryBlocker && (
          <p className="font-medium">
            {primaryBlocker.is_permanent
              ? "This expense can't be reimbursed."
              : "This expense can't be reimbursed yet."}
          </p>
        )}

        <div className="space-y-1.5">
          {gates.map((g) => (
            <GateRow key={g.gate} gate={g} />
          ))}
        </div>

        {/* Suppressed when timing permanently refuses. Inviting someone to
            correct a date that cannot rescue the expense wastes their time and
            implies the outcome is negotiable. */}
        {!(primaryBlocker?.is_permanent && !usesPaymentDate) && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(serviceDate ?? "");
              setEditing(true);
            }}
          >
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            {usesPaymentDate
              ? "Set the date of care"
              : "Change the date of care"}
          </Button>
        )}

        {editing && (
          <div className="space-y-2 pt-1">
            <Label htmlFor={`service-date-${invoiceId}`} className="text-xs">
              When was the care received?
            </Label>
            <Input
              id={`service-date-${invoiceId}`}
              type="date"
              value={draft}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDraft(e.target.value)}
              className="max-w-[200px]"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveServiceDate}
                disabled={saving || !draft}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
