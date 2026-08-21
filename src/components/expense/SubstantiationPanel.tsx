// Workstream D5 — the substantiation step.
//
// Where documentation, date of service, patient, tags and the reimbursable
// amount are resolved together. The three eligibility gates report alongside
// them, because the answers here are what move those gates.
//
// The IRS note is informational and blocks nothing. The spec is explicit that
// it "explains what the IRS would want in an audit without blocking anything
// else" — a user with a bank record and no receipt still has a real expense,
// and refusing to let them record it would lose information rather than
// protect them.

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Info, Plus, X, Loader2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/utils/errorHandler";
import { PatientPicker } from "@/components/family/PatientPicker";
import { EligibilityGates } from "@/components/hsa/EligibilityGates";
import {
  useExpenseTags,
  useAllTags,
  useSubstantiationStatus,
} from "@/hooks/useExpenseTags";

/** Workstream D6: present only when this expense is a car trip, not a payment. */
export interface MileageBreakdown {
  miles: number;
  rate: number;
  trips: number | null;
  parkingAndTolls: number | null;
}

export interface SubstantiationPanelProps {
  invoiceId: string;
  amountPaid: number;
  reimbursableAmount: number | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  patientId: string | null;
  mileage?: MileageBreakdown | null;
  onSaved?: () => void;
  /** Hide the card's own title when the surrounding surface already has one. */
  hideHeader?: boolean;
}

export function SubstantiationPanel({
  invoiceId,
  amountPaid,
  reimbursableAmount,
  serviceDate,
  serviceDateEnd,
  patientId,
  mileage,
  onSaved,
  hideHeader = false,
}: SubstantiationPanelProps) {
  const queryClient = useQueryClient();
  const { tags, addTag, removeTag } = useExpenseTags(invoiceId);
  const { tags: allTags } = useAllTags();
  const { status } = useSubstantiationStatus(invoiceId);

  const [tagDraft, setTagDraft] = useState("");
  const [start, setStart] = useState(serviceDate ?? "");
  const [end, setEnd] = useState(serviceDateEnd ?? "");
  const [multiDay, setMultiDay] = useState(!!serviceDateEnd);
  const [amount, setAmount] = useState(
    String(reimbursableAmount ?? amountPaid ?? ""),
  );
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["bill", invoiceId] });
    queryClient.invalidateQueries({
      queryKey: ["eligibility-gates", invoiceId],
    });
    queryClient.invalidateQueries({ queryKey: ["timing-gate", invoiceId] });
    queryClient.invalidateQueries({
      queryKey: ["substantiation-status", invoiceId],
    });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    onSaved?.();
  };

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("invoices")
        .update(patch)
        .eq("id", invoiceId);
      if (error) throw error;
      refresh();
      return true;
    } catch (error) {
      logError("Saving substantiation details failed", error);
      // The reimbursable cap is a database constraint, so the friendly
      // explanation belongs here rather than in a generic failure message.
      const message =
        error instanceof Error &&
        /reimbursable_within_paid|check constraint/i.test(error.message)
          ? `You can't claim more than the $${amountPaid.toFixed(2)} you paid.`
          : "Couldn't save that. Please try again.";
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveDates = async () => {
    if (!start) return;
    if (multiDay && end && end < start) {
      toast.error("The care can't end before it started.");
      return;
    }
    const ok = await save({
      service_date: start,
      service_date_end: multiDay && end ? end : null,
    });
    if (ok) toast.success("Dates of care saved.");
  };

  const saveAmount = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (parsed > amountPaid) {
      toast.error(
        `You can't claim more than the $${amountPaid.toFixed(2)} you paid.`,
      );
      return;
    }
    const ok = await save({ reimbursable_amount: parsed });
    if (ok) toast.success("Claimable amount saved.");
  };

  const suggestions = allTags
    .filter(
      (t) =>
        !tags.some((existing) => existing.id === t.id) &&
        (tagDraft.trim() === "" ||
          t.name.toLowerCase().includes(tagDraft.trim().toLowerCase())),
    )
    .slice(0, 6);

  return (
    <Card>
      {/* Suppressed when the host already says what this is -- the dialog
          version is titled "Substantiate this expense" itself, and repeating
          it two inches lower reads as a rendering bug. */}
      {!hideHeader && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Substantiate this expense
          </CardTitle>
          <CardDescription>
            The details that decide whether you can claim it, and the paperwork
            you&rsquo;d want if anyone ever asked.
          </CardDescription>
        </CardHeader>
      )}

      <CardContent className={hideHeader ? "space-y-5 pt-6" : "space-y-5"}>
        <EligibilityGates invoiceId={invoiceId} serviceDate={serviceDate} />

        {status && !status.is_complete && status.missing.length > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Still to add: {status.missing.join(", ")}. You can claim it
              without these, but they&rsquo;re what makes the claim hold up.
            </AlertDescription>
          </Alert>
        )}

        {/* Dates of care */}
        <div className="space-y-2">
          <Label htmlFor="service-start">When was the care?</Label>
          <p className="text-xs text-muted-foreground">
            The IRS goes by when you were treated, not when you paid. For a
            hospital stay or a course of treatment, give the range.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Input
                id="service-start"
                type="date"
                value={start}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setStart(e.target.value)}
                className="w-[170px]"
              />
            </div>
            {multiDay && (
              <div className="space-y-1">
                <Label htmlFor="service-end" className="text-xs">
                  through
                </Label>
                <Input
                  id="service-end"
                  type="date"
                  value={end}
                  min={start || undefined}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-[170px]"
                />
              </div>
            )}
            {!multiDay ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMultiDay(true)}
                disabled={saving}
              >
                It spanned several days
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMultiDay(false);
                  setEnd("");
                }}
                disabled={saving}
              >
                Single day
              </Button>
            )}
            <Button size="sm" onClick={saveDates} disabled={saving || !start}>
              Save
            </Button>
          </div>
        </div>

        <Separator />

        {/* Patient */}
        <div className="space-y-2">
          <Label htmlFor="subst-patient">Who was it for?</Label>
          <PatientPicker
            id="subst-patient"
            value={patientId}
            onChange={async (id) => {
              const ok = await save({ patient_id: id });
              if (ok) toast.success("Patient saved.");
            }}
          />
        </div>

        <Separator />

        {/* Reimbursable amount */}
        <div className="space-y-2">
          <Label htmlFor="reimbursable">How much can you claim?</Label>
          {mileage ? (
            // Show the arithmetic. This figure was never a receipt, so if it
            // is ever queried the only defence is the working behind it.
            <p className="text-xs text-muted-foreground">
              {mileage.miles.toFixed(1)} miles
              {mileage.trips && mileage.trips > 1
                ? ` over ${mileage.trips} trips`
                : ""}{" "}
              at {(mileage.rate * 100).toFixed(0)}&cent; a mile
              {mileage.parkingAndTolls
                ? `, plus $${mileage.parkingAndTolls.toFixed(2)} in parking and tolls`
                : ""}{" "}
              &mdash; ${amountPaid.toFixed(2)}. Lower it if part of the driving
              wasn&rsquo;t for medical care.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              You paid ${amountPaid.toFixed(2)}. Lower this if some of it came
              back to you &mdash; an insurance refund, say. You can never claim
              more than you paid.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              id="reimbursable"
              type="number"
              step="0.01"
              min="0"
              max={amountPaid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-[150px]"
            />
            <Button size="sm" onClick={saveAmount} disabled={saving}>
              Save
            </Button>
            {parseFloat(amount) < amountPaid && (
              <span className="text-xs text-muted-foreground">
                ${(amountPaid - parseFloat(amount || "0")).toFixed(2)} not
                claimable
              </span>
            )}
          </div>
        </div>

        <Separator />

        {/* Tags */}
        <div className="space-y-2">
          <Label htmlFor="tag-input">Tags</Label>
          <p className="text-xs text-muted-foreground">
            However you&rsquo;d go looking for this later &mdash; a person, a
            condition, a tax year. An expense can carry as many as you like.
          </p>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Badge key={t.id} variant="secondary" className="gap-1">
                  {t.name}
                  <button
                    type="button"
                    onClick={() => removeTag.mutate(t.id)}
                    className="opacity-60 hover:opacity-100"
                    aria-label={`Remove tag ${t.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              id="tag-input"
              value={tagDraft}
              placeholder="e.g. Maya, orthodontics, 2025 taxes"
              maxLength={40}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagDraft.trim()) {
                  e.preventDefault();
                  addTag.mutate(tagDraft, {
                    onSuccess: () => setTagDraft(""),
                  });
                }
              }}
              className="max-w-[280px]"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!tagDraft.trim() || addTag.isPending}
              onClick={() =>
                addTag.mutate(tagDraft, { onSuccess: () => setTagDraft("") })
              }
            >
              {addTag.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    addTag.mutate(t.name, { onSuccess: () => setTagDraft("") })
                  }
                  className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* What good documentation looks like. Informational only. */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {mileage ? (
              <>
                <strong>What the IRS would want to see:</strong> a mileage log
                &mdash; the dates you drove, where you went, why the trip was
                for medical care, and the miles. That&rsquo;s what this record
                is, so there&rsquo;s no receipt to chase. Keep parking and toll
                receipts if you claimed them.
              </>
            ) : (
              <>
                <strong>What the IRS would want to see:</strong> an itemised
                statement or receipt showing the provider, the date of service,
                the patient, what was done, and the amount. A card statement
                alone usually isn&rsquo;t enough on its own &mdash; but record
                the expense anyway and add the paperwork when you have it.
              </>
            )}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
