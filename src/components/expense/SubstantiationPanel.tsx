// Workstream D5 — the substantiation step (SUBSTANTIATE_SPEC S15–S23, S29, S35).
//
// One component for the dialog and the full expense page, so the two cannot
// drift apart (S35). Top to bottom:
//
//   1. The payment   -- provider, when it was paid, what was paid, and
//                       Claiming. What the bank recorded is shown and never
//                       edited; Claiming is the one editable part.
//   2. `documents`   -- a slot the host fills, so Documents sits between the
//                       payment and the questions it answers.
//   3. Date of care  -- pre-filled with the payment date, saved as it changes.
//   4. Who for       -- the family list with "You" pre-selected.
//   5. Tags          -- always visible.
//
// Every field already holds a sensible value before it is touched; the work is
// correcting exceptions. Nothing is explained unless something is wrong, and
// then beside the field it concerns (S23).
//
// Nothing here blocks. A missing receipt never stops anything, and the person
// is the approver. What this surface reports are the facts: care before the HSA
// opened, a patient who is not a tax dependent.
//
// The scan fills gaps and never overwrites a person (S9). Each fillable field
// records who set it: a value a document supplied is marked "From your
// receipt"; anything the person types or picks here is saved as theirs, so a
// later scan leaves it alone. Clearing the date hands it back to the scan.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Money } from "@/components/ui/money";
import { formatCurrency, todayLocalISO } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { paidShortlyAfterHsaOpened } from "@/lib/careDateDefaults";
import { Plus, X, Loader2, ClipboardCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/utils/errorHandler";
import { PatientPicker } from "@/components/family/PatientPicker";
import { useExpenseTags, useAllTags } from "@/hooks/useExpenseTags";
import { useEligibilityGates } from "@/hooks/useEligibilityGates";
import { useHSAEstablishmentDate } from "@/hooks/useHSAEligibility";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { useAutosave } from "@/hooks/useAutosave";
import type { MileageBreakdown } from "@/lib/mileageBreakdown";
import type { Json } from "@/integrations/supabase/types";

/** Written with every edit made here: the value is now the person's (S9). */
const BY_PERSON = { by: "person" } as const;

/** The document a field's value came from, if a scan put it there. */
function scannedFrom(source: Json | null | undefined): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  return source.by === "scan" && typeof source.receipt_id === "string"
    ? source.receipt_id
    : null;
}

export interface SubstantiationPanelProps {
  invoiceId: string;
  /** The provider -- the bank's text until a document names them (S12).
   *  Shown, never edited here. */
  vendor: string;
  /** The name as it first arrived, kept when a document replaced it (S12). */
  vendorOriginal?: string | null;
  paidDate: string;
  amountPaid: number;
  /** `not_reimbursable` marks a charge paid with the HSA card itself (S16). */
  claimState?: string | null;
  reimbursableAmount: number | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  patientId: string | null;
  /** Who set the date and the patient: null (a default), a person, or a
   *  document (S9). */
  serviceDateSource?: Json | null;
  patientSource?: Json | null;
  /** Each attached document's id, as a noun ("receipt", "itemized
   *  statement"), for "From your receipt". */
  documentNouns?: Record<string, string>;
  /** Patients the attached documents name (S20). */
  namedPatients?: { name: string; noun: string }[];
  mileage?: MileageBreakdown | null;
  /** Rendered between the payment and the date of care. */
  documents?: ReactNode;
  /** Rendered last, under the tags: the decision, on surfaces that do not pin
   *  it to a footer of their own (S30). */
  footer?: ReactNode;
  onSaved?: () => void;
  /** Hide the card's own title when the surrounding surface already has one. */
  hideHeader?: boolean;
}

type SavedField = "claim" | "date" | "patient" | "tags";

/** The small confirmation beside a field that just saved (S22). */
function Saved({ show }: { show: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="text-xs text-muted-foreground"
    >
      {show ? "Saved." : ""}
    </span>
  );
}

/** "From your receipt", beside a field a document filled (S9). */
function FromDocument({ noun }: { noun: string | null | undefined }) {
  if (!noun) return null;
  return (
    <span className="text-xs text-muted-foreground">From your {noun}</span>
  );
}

/**
 * The first name an attached document gives that is on nobody's family list
 * (S20), so the person can add them. Matched by the same rule the scan fills
 * with (match_family_member), re-asked whenever the roster changes.
 */
function useUnlistedPatient(
  named: { name: string; noun: string }[],
  rosterKey: string,
) {
  const names = [...new Set(named.map((n) => n.name))];
  const { data } = useQuery({
    queryKey: ["unlisted-patient", names, rosterKey],
    enabled: names.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      for (const name of names) {
        const { data: match, error } = await supabase.rpc(
          "match_family_member",
          { p_name: name },
        );
        if (error) throw error;
        if (!match) return named.find((n) => n.name === name) ?? null;
      }
      return null;
    },
  });
  return data ?? null;
}

export function SubstantiationPanel({
  invoiceId,
  vendor,
  vendorOriginal,
  paidDate,
  amountPaid,
  claimState,
  reimbursableAmount,
  serviceDate,
  serviceDateEnd,
  patientId,
  serviceDateSource,
  patientSource,
  documentNouns = {},
  namedPatients = [],
  mileage,
  documents,
  footer,
  onSaved,
  hideHeader = false,
}: SubstantiationPanelProps) {
  const queryClient = useQueryClient();
  const { tags, addTag, removeTag } = useExpenseTags(invoiceId);
  const { tags: allTags } = useAllTags();
  const { gates } = useEligibilityGates(invoiceId);
  const { establishmentDate } = useHSAEstablishmentDate();
  const { self, members } = useFamilyRoster();
  const unlisted = useUnlistedPatient(
    namedPatients,
    members.map((m) => `${m.id}:${m.name}`).join(","),
  );
  // A marker only while the document it came from is still attached.
  const dateNoun = documentNouns[scannedFrom(serviceDateSource) ?? ""];
  const patientNoun = documentNouns[scannedFrom(patientSource) ?? ""];

  const [tagDraft, setTagDraft] = useState("");
  // S18: a blank date of care is shown as the payment date, which is what the
  // rules were already using. It only becomes a stored value once edited.
  const [start, setStart] = useState(serviceDate ?? paidDate);
  const [end, setEnd] = useState(serviceDateEnd ?? "");
  const [multiDay, setMultiDay] = useState(!!serviceDateEnd);
  const [dateError, setDateError] = useState<string | null>(null);
  const [claim, setClaim] = useState(
    String(reimbursableAmount ?? amountPaid ?? ""),
  );
  const [claimError, setClaimError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedField | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = todayLocalISO();

  const flash = (field: SavedField) => {
    setSaved(field);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 2500);
  };
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

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

  const save = async (
    patch: Record<string, unknown>,
    { silent = false }: { silent?: boolean } = {},
  ) => {
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
      if (silent) return false;
      // The reimbursable cap is a database constraint, so the friendly
      // explanation belongs here rather than in a generic failure message.
      const message =
        error instanceof Error &&
        /reimbursable_within_paid|check constraint/i.test(error.message)
          ? `You can't claim more than the ${formatCurrency(amountPaid)} you paid.`
          : "Couldn't save that. Please try again.";
      toast.error(message);
      return false;
    }
  };

  // ── Claiming ────────────────────────────────────────────────────────────
  const claimSaver = useAutosave(async (amount: number) => {
    if (await save({ reimbursable_amount: amount })) flash("claim");
  });

  const onClaimChange = (raw: string) => {
    setClaim(raw);
    const parsed = parseFloat(raw);
    if (raw.trim() === "" || isNaN(parsed) || parsed < 0) {
      // Mid-typing, or not a number: nothing to save yet, nothing to say.
      claimSaver.cancel();
      setClaimError(null);
      return;
    }
    if (parsed > amountPaid) {
      claimSaver.cancel();
      setClaimError(
        `Can't be more than the ${formatCurrency(amountPaid)} you paid.`,
      );
      return;
    }
    setClaimError(null);
    claimSaver.schedule(Math.round(parsed * 100) / 100);
  };

  // Follow the stored value when it changes underneath us (a scan filling in,
  // the other surface saving) -- but never while the person is mid-edit, and
  // never by reformatting what they typed: "12." and 12 are the same amount.
  useEffect(() => {
    if (claimSaver.hasPending()) return;
    const stored = reimbursableAmount ?? amountPaid;
    if (parseFloat(claim) !== stored) setClaim(String(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reimbursableAmount, amountPaid]);

  // ── Date of care ────────────────────────────────────────────────────────
  const dateSaver = useAutosave(
    async (v: { start: string; end: string; multi: boolean }) => {
      const nextEnd = v.multi && v.end && v.start ? v.end : null;
      // "It spanned several days" with no end date yet changes nothing. Saving
      // the pre-fill then would turn the payment date into a date the person
      // chose, and the scan could no longer fill it.
      if (!serviceDate && v.start === paidDate && !nextEnd) return;
      const ok = await save({
        // Cleared hands the field back: the date of care falls back to the
        // payment date, and the next document to name one fills it (S9).
        service_date: v.start || null,
        service_date_end: nextEnd,
        service_date_source: v.start ? BY_PERSON : null,
      });
      if (ok) flash("date");
    },
  );

  const changeDates = (next: {
    start: string;
    end: string;
    multi: boolean;
  }) => {
    setStart(next.start);
    setEnd(next.end);
    setMultiDay(next.multi);

    if (next.multi && next.end && next.start && next.end < next.start) {
      dateSaver.cancel();
      setDateError("The care can't end before it started.");
      return;
    }
    setDateError(null);
    dateSaver.schedule(next);
  };

  useEffect(() => {
    if (dateSaver.hasPending()) return;
    setStart(serviceDate ?? paidDate);
    if (serviceDateEnd) {
      setEnd(serviceDateEnd);
      setMultiDay(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceDate, serviceDateEnd, paidDate]);

  // ── Who it was for ──────────────────────────────────────────────────────
  // S20: "You" is the starting answer, and it is written down rather than just
  // drawn. The dependency check reads patient_id; a default that only showed on
  // screen left the check asking who the expense was for while the field
  // answered "You". Written silently -- nothing the person did.
  const defaultedFor = useRef<string | null>(null);
  useEffect(() => {
    if (patientId || !self || defaultedFor.current === invoiceId) return;
    defaultedFor.current = invoiceId;
    void save({ patient_id: self.id }, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, self, invoiceId]);

  // ── Problems, each beside its field (S23) ───────────────────────────────
  const timing = gates.find((g) => g.gate === "timing");
  const dependency = gates.find((g) => g.gate === "dependency");
  const timingProblem =
    timing && timing.status !== "eligible" ? timing.reason : null;
  // While "You" is being written the check still reflects the old, blank
  // answer; saying "we need to know who" then would contradict the field.
  const dependencyProblem =
    dependency && dependency.status !== "eligible" && patientId
      ? dependency.reason
      : null;

  // Still the pre-fill: nothing stored, and what is shown is the payment date.
  // Clearing a typed date lands back here, which is right -- it is the
  // pre-fill again.
  const stillPrefilled =
    !serviceDate && start === paidDate && !dateSaver.hasPending();
  const checkTheDate =
    stillPrefilled &&
    !timingProblem &&
    paidShortlyAfterHsaOpened(paidDate, establishmentDate);

  const parsedClaim = parseFloat(claim);
  const notClaimed =
    !isNaN(parsedClaim) && parsedClaim >= 0 && parsedClaim < amountPaid
      ? amountPaid - parsedClaim
      : 0;
  const paidFromHsa = claimState === "not_reimbursable";

  const suggestions = allTags
    .filter(
      (t) =>
        !tags.some((existing) => existing.id === t.id) &&
        (tagDraft.trim() === "" ||
          t.name.toLowerCase().includes(tagDraft.trim().toLowerCase())),
    )
    .slice(0, 6);

  const body = (
    <>
      {/* 1. The payment. */}
      <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium truncate">{vendor}</p>
            {/* S12: the provider's name leads; the bank's text stays, small,
                as the link back to the statement. */}
            {vendorOriginal && vendorOriginal !== vendor && (
              <p className="truncate text-xs text-muted-foreground">
                {vendorOriginal}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Paid {formatDateOnly(paidDate)}
            </p>
          </div>
          <Money
            value={amountPaid}
            className="text-lg font-semibold shrink-0"
          />
        </div>

        {mileage && (
          // Show the arithmetic. This figure was never a receipt, so if it is
          // ever queried the only defence is the working behind it (S17).
          <p className="text-sm text-muted-foreground">
            {mileage.miles.toFixed(1)} miles
            {mileage.trips && mileage.trips > 1
              ? ` over ${mileage.trips} trips`
              : ""}{" "}
            at {(mileage.rate * 100).toFixed(0)}&cent; a mile
            {mileage.parkingAndTolls
              ? `, plus ${formatCurrency(mileage.parkingAndTolls)} in parking and tolls`
              : ""}
          </p>
        )}

        {paidFromHsa ? (
          // S16: the HSA already paid, so there is nothing to reimburse. It
          // still needs proof -- the IRS can ask about any HSA spending.
          <p className="text-sm">
            Paid from your HSA, so there&rsquo;s nothing to reimburse.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="reimbursable" className="text-sm">
                Claiming
              </Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="reimbursable"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max={amountPaid}
                  value={claim}
                  onChange={(e) => onClaimChange(e.target.value)}
                  onBlur={claimSaver.flush}
                  className="w-[130px]"
                  aria-invalid={!!claimError}
                />
              </div>
              {notClaimed > 0 && !claimError && (
                <span className="text-sm text-muted-foreground">
                  {formatCurrency(notClaimed)} won&rsquo;t be claimed.
                </span>
              )}
              <Saved show={saved === "claim"} />
            </div>
            {claimError && (
              <p className="text-sm text-destructive">{claimError}</p>
            )}
          </div>
        )}
      </div>

      {/* 2. Documents, placed by the host. */}
      {documents}

      {/* 3. Date of care. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="service-start">Date of care</Label>
          <FromDocument noun={dateNoun} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            id="service-start"
            type="date"
            value={start}
            max={today}
            onChange={(e) =>
              changeDates({ start: e.target.value, end, multi: multiDay })
            }
            onBlur={dateSaver.flush}
            className="w-[170px]"
          />
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
                max={today}
                onChange={(e) =>
                  changeDates({ start, end: e.target.value, multi: true })
                }
                onBlur={dateSaver.flush}
                className="w-[170px]"
              />
            </div>
          )}
          {!multiDay ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => changeDates({ start, end, multi: true })}
            >
              It spanned several days
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => changeDates({ start, end: "", multi: false })}
            >
              Single day
            </Button>
          )}
          <Saved show={saved === "date"} />
        </div>
        {dateError && <p className="text-sm text-destructive">{dateError}</p>}
        {timingProblem && (
          <p className="text-sm text-destructive">{timingProblem}</p>
        )}
        {checkTheDate && (
          <p className="text-sm text-amber-700 dark:text-amber-500">
            Care before {formatDateOnly(establishmentDate)} can&rsquo;t be
            reimbursed. Check the date on the bill.
          </p>
        )}
      </div>

      <Separator />

      {/* 4. Who it was for. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="subst-patient">Who was it for?</Label>
          <FromDocument noun={patientNoun} />
          <Saved show={saved === "patient"} />
        </div>
        <PatientPicker
          id="subst-patient"
          value={patientId ?? self?.id ?? null}
          hideWarnings
          onChange={async (id) => {
            if (await save({ patient_id: id, patient_source: BY_PERSON })) {
              flash("patient");
            }
          }}
        />
        {unlisted && (
          <p className="text-sm text-muted-foreground">
            Your {unlisted.noun} names {unlisted.name}.{" "}
            <Link
              to="/settings"
              className="underline underline-offset-2 hover:opacity-80"
            >
              Add them to your family
            </Link>
          </p>
        )}
        {dependencyProblem && (
          <p className="text-sm text-destructive">
            {dependencyProblem}{" "}
            <Link
              to="/settings"
              className="underline underline-offset-2 hover:opacity-80"
            >
              <Users className="mr-0.5 inline h-3 w-3" />
              Update your family list
            </Link>
          </p>
        )}
      </div>

      <Separator />

      {/* 5. Tags -- visible, not folded away behind "More" (S21). */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="tag-input">Tags</Label>
          <Saved show={saved === "tags"} />
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t.id} variant="secondary" className="gap-1">
                {t.name}
                <button
                  type="button"
                  onClick={() =>
                    removeTag.mutate(t.id, { onSuccess: () => flash("tags") })
                  }
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
                  onSuccess: () => {
                    setTagDraft("");
                    flash("tags");
                  },
                });
              }
            }}
            className="max-w-[280px]"
          />
          <Button
            size="sm"
            variant="outline"
            aria-label="Add tag"
            disabled={!tagDraft.trim() || addTag.isPending}
            onClick={() =>
              addTag.mutate(tagDraft, {
                onSuccess: () => {
                  setTagDraft("");
                  flash("tags");
                },
              })
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
                  addTag.mutate(t.name, {
                    onSuccess: () => {
                      setTagDraft("");
                      flash("tags");
                    },
                  })
                }
                className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {footer && (
        <>
          <Separator />
          {footer}
        </>
      )}
    </>
  );

  // In the dialog the surrounding surface is already a framed container with
  // its own title, so a nested card would only add a second border.
  if (hideHeader) return <div className="space-y-5">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Substantiate this expense
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">{body}</CardContent>
    </Card>
  );
}
