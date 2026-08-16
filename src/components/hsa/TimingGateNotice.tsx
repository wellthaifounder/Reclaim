// Workstream D2 — Gate 1 reported to the user.
//
// The spec is explicit that this gate is computed and REPORTED, never asked:
// whether care predates the HSA is a fact, not a judgement, and presenting it
// as a question invites a wrong answer on something an auditor would check.
//
// So there is exactly one input here — the date of service — and it exists
// because that date is the gate's only variable and bank sync cannot know it.
// A charge that settles in January for a December visit is a December expense,
// and against a January cliff those are opposite answers.

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/utils/errorHandler";
import { useTimingGate } from "@/hooks/useHSAEligibility";

export function TimingGateNotice({
  invoiceId,
  serviceDate,
}: {
  invoiceId: string;
  /** invoices.service_date — null when we're falling back to the payment date. */
  serviceDate: string | null;
}) {
  const { gate, isLoading } = useTimingGate(invoiceId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(serviceDate ?? "");
  const [saving, setSaving] = useState(false);

  if (isLoading || !gate) return null;

  const saveServiceDate = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ service_date: draft })
        .eq("id", invoiceId);
      if (error) throw error;

      // A database trigger re-runs the cliff on this row, so the verdict can
      // flip in either direction as a result of this save.
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

  const Icon =
    gate.status === "ineligible"
      ? CircleAlert
      : gate.status === "eligible"
        ? CircleCheck
        : HelpCircle;

  return (
    <Alert variant={gate.status === "ineligible" ? "destructive" : "default"}>
      <Icon className="h-4 w-4" />
      <AlertDescription className="space-y-2">
        <p>{gate.reason}</p>

        {/* Only offered where it can change the answer. Prompting for a date
            of service on an expense that already has one is noise. */}
        {gate.uses_payment_date && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(serviceDate ?? "");
              setEditing(true);
            }}
          >
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            Set the date of care
          </Button>
        )}

        {!gate.uses_payment_date && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="block text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            Change the date of care
          </button>
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
