// Workstream D3/D4 — the eligibility gates, reported.
//
// Replaces TimingGateNotice, which showed Gate 1 alone. All three gates appear
// together: an expense can fail more than one, and showing only the fixable
// one sends the user off to correct something that will not change the answer.
//
// Gates 1 and 2 are facts, computed and REPORTED rather than asked — whether
// care predates the HSA, and whether the patient is a tax dependent, are
// already recorded elsewhere. Gate 3 is the only one where judgement lives,
// which is why it is the only one a user's own confirmation can outrank.
//
// 'conditional' is not a refusal. It means "claimable once you have the
// letter", and it gets its own wording throughout for that reason.

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
  FileWarning,
  HelpCircle,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/utils/errorHandler";
import {
  useEligibilityGates,
  useClassifyExpense,
  type EligibilityGate,
} from "@/hooks/useEligibilityGates";
import { useTimingGate } from "@/hooks/useHSAEligibility";

function GateRow({ gate }: { gate: EligibilityGate }) {
  const Icon =
    gate.status === "ineligible"
      ? CircleAlert
      : gate.status === "eligible"
        ? CircleCheck
        : gate.status === "conditional"
          ? FileWarning
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
        {/* A conditional expense is claimable — the user just has to fetch
            something. Shown as an instruction rather than folded into the
            refusal text, because "go and get this" and "this can never be
            claimed" must not read the same way. */}
        {gate.action_prompt && (
          <p className="mt-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            {gate.action_prompt}
          </p>
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
  const { gates, primaryBlocker, pub502, isLoading } =
    useEligibilityGates(invoiceId);
  const classify = useClassifyExpense();
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
        {/* Three different refusals that mean three different things. Timing
            is final. Dependency turns on an answer the user can correct.
            Pub 502 is a judgement they can disagree with. Collapsing them into
            one sentence either overstates a soft no or understates a hard
            one. */}
        {primaryBlocker && (
          <p className="font-medium">
            {primaryBlocker.gate === "timing"
              ? "This expense can't be reimbursed."
              : primaryBlocker.gate === "dependency"
                ? "This expense can't be reimbursed as things stand."
                : "This doesn't look like an expense the IRS allows."}
          </p>
        )}
        {/* Deliberately a different sentence from a refusal. A conditional
            expense IS claimable; the user is being told what to fetch. */}
        {!primaryBlocker && pub502?.status === "conditional" && (
          <p className="font-medium">
            You can claim this once you have the right paperwork.
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

        {/* Workstream D4: Gate 3 runs here rather than at capture. Offered
            rather than fired automatically -- it costs an AI call, and the
            answer is only worth having once documents and a date of service
            exist. */}
        {pub502?.status === "unknown" && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => classify.mutate(invoiceId)}
            disabled={classify.isPending}
          >
            {classify.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Work out if this qualifies
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
