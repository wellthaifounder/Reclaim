// Workstream D6 — medical mileage.
//
// The one expense bank sync structurally cannot see. Pub. 502 allows a
// per-mile amount for travel primarily for and essential to medical care, and
// for anyone driving to dialysis three times a week it is one of the largest
// claims they have — and the one most often left on the table.
//
// Three things this screen is careful about.
//
// 1. IT SHOWS ITS WORKING. The rate, the year it comes from, and the
//    arithmetic are all on screen. A number that appears on a reimbursement
//    claim should never be one the user has to take on trust.
//
// 2. IT DOES NOT DO THE ARITHMETIC. Miles and rate go to the database and the
//    database multiplies them, so there is exactly one implementation of the
//    sum. What is shown here is a preview.
//
// 3. IT REFUSES TO STRADDLE A RATE CHANGE. The IRS rate depends on the date of
//    service and has changed mid-year. A batch of trips spanning a change has
//    two correct answers and no single one, so the screen asks for two
//    entries rather than quietly picking the rate at one end.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Car, Info, Loader2, TriangleAlert } from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { PatientPicker } from "@/components/family/PatientPicker";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import {
  medicalMileageRate,
  medicalMileageAmount,
} from "@/lib/regulatoryLimits";

const today = () => new Date().toISOString().slice(0, 10);

export function MileageEntryForm() {
  const navigate = useNavigate();
  const { self: rosterSelf } = useFamilyRoster();

  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [milesPerTrip, setMilesPerTrip] = useState("");
  const [roundTrip, setRoundTrip] = useState(true);
  const [trips, setTrips] = useState("1");
  const [parking, setParking] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectivePatientId = patientId ?? rosterSelf?.id ?? null;

  const oneWay = parseFloat(milesPerTrip);
  const tripCount = recurring ? parseInt(trips, 10) : 1;
  const parkingAmount = parseFloat(parking) || 0;

  const perTrip =
    Number.isFinite(oneWay) && oneWay > 0
      ? Math.round(oneWay * (roundTrip ? 2 : 1) * 10) / 10
      : 0;
  const totalMiles =
    perTrip > 0 && Number.isFinite(tripCount) && tripCount > 0
      ? Math.round(perTrip * tripCount * 10) / 10
      : 0;

  const startPeriod = medicalMileageRate(start);
  const endPeriod = end ? medicalMileageRate(end) : startPeriod;

  // A range crossing a rate change has no single correct answer.
  const straddles =
    recurring &&
    !!end &&
    !!startPeriod &&
    !!endPeriod &&
    startPeriod !== endPeriod;

  const preview = useMemo(
    () =>
      startPeriod && totalMiles > 0
        ? medicalMileageAmount(
            totalMiles,
            startPeriod.ratePerMile,
            parkingAmount,
          )
        : 0,
    [startPeriod, totalMiles, parkingAmount],
  );

  const blocked =
    !destination.trim() ||
    !start ||
    !startPeriod ||
    totalMiles <= 0 ||
    straddles ||
    (recurring && !!end && end < start);

  const save = async () => {
    if (!startPeriod) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in to add an expense.");

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          vendor: destination.trim(),
          category: "Mileage",
          source: "manual",
          date: start,
          service_date: start,
          service_date_end: recurring && end ? end : null,
          notes: purpose.trim() || null,
          patient_id: effectivePatientId,
          // Transportation for medical care is qualified outright, so the
          // basis is recorded directly. There is no vendor string here worth
          // sending to a classifier — "drive to Dr Smith" is not evidence of
          // anything the user has not already told us.
          eligibility_basis_rule_id: "medical-mileage",
          mileage_miles: totalMiles,
          mileage_rate: startPeriod.ratePerMile,
          mileage_trips: recurring ? tripCount : null,
          mileage_parking_tolls: parkingAmount > 0 ? parkingAmount : null,
          // `amount` is NOT NULL, so something has to go in it. Whatever this
          // is, trg_invoices_mileage overwrites it -- along with amount_paid
          // and reimbursable_amount -- from the miles and the rate. The value
          // sent here is the on-screen preview and is never trusted.
          amount: preview,
        })
        .select("id")
        .single();
      if (error || !invoice) throw error ?? new Error("Insert failed");

      toast.success(`Mileage saved — $${preview.toFixed(2)} claimable.`);
      navigate(`/bills/${invoice.id}`);
    } catch (error) {
      logError("MileageEntryForm save", error);
      toast.error("Couldn't save that trip. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="h-5 w-5" />
          Log medical driving
        </CardTitle>
        <CardDescription>
          The IRS lets you claim a set amount per mile for driving to medical
          care &mdash; plus what you paid to park and in tolls. Your bank never
          sees this, so it only counts if you record it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="mileage-destination">Where did you drive to?</Label>
          <Input
            id="mileage-destination"
            value={destination}
            placeholder="e.g. Riverbend Oncology"
            maxLength={100}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mileage-purpose">What was the trip for?</Label>
          <Textarea
            id="mileage-purpose"
            value={purpose}
            placeholder="e.g. Weekly chemotherapy sessions"
            maxLength={500}
            rows={2}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            A mileage log is what stands in for a receipt here, and the reason
            for the trip is the part of it only you know.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mileage-patient">Who was the care for?</Label>
          <PatientPicker
            id="mileage-patient"
            value={effectivePatientId}
            onChange={setPatientId}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="mileage-start">When?</Label>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              id="mileage-start"
              type="date"
              value={start}
              max={today()}
              onChange={(e) => setStart(e.target.value)}
              className="w-[170px]"
            />
            {recurring && (
              <div className="space-y-1">
                <Label htmlFor="mileage-end" className="text-xs">
                  through
                </Label>
                <Input
                  id="mileage-end"
                  type="date"
                  value={end}
                  min={start || undefined}
                  max={today()}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-[170px]"
                />
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRecurring(!recurring);
                if (recurring) {
                  setEnd("");
                  setTrips("1");
                }
              }}
            >
              {recurring
                ? "It was a single trip"
                : "I made this trip repeatedly"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mileage-distance">
              {roundTrip ? "Miles one way" : "Miles driven"}
            </Label>
            <Input
              id="mileage-distance"
              type="number"
              step="0.1"
              min="0"
              value={milesPerTrip}
              placeholder="0"
              onChange={(e) => setMilesPerTrip(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setRoundTrip(!roundTrip)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {roundTrip
                ? "Counting the drive home too. Only went one way?"
                : "One way only. Did you drive home as well?"}
            </button>
          </div>

          {recurring && (
            <div className="space-y-1.5">
              <Label htmlFor="mileage-trips">How many trips?</Label>
              <Input
                id="mileage-trips"
                type="number"
                step="1"
                min="1"
                value={trips}
                onChange={(e) => setTrips(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mileage-parking">
              Parking and tolls (optional)
            </Label>
            <Input
              id="mileage-parking"
              type="number"
              step="0.01"
              min="0"
              value={parking}
              placeholder="0.00"
              onChange={(e) => setParking(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Claimable on top of the per-mile amount, not instead of it.
            </p>
          </div>
        </div>

        <Separator />

        {/* The working, shown. */}
        {!startPeriod ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              We don&rsquo;t have an IRS mileage rate on file for{" "}
              {start || "that date"} yet. Rates are published each December
              &mdash; if this date is in a new year, the app needs updating
              before it can put a number on this trip.
            </AlertDescription>
          </Alert>
        ) : straddles ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              The IRS rate changes between {start} and {end}, so these trips
              aren&rsquo;t all worth the same amount. Log them as two entries,
              one either side of the change.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {totalMiles > 0 ? totalMiles.toFixed(1) : "0"} miles
                {recurring && tripCount > 1
                  ? ` (${perTrip.toFixed(1)} x ${tripCount} trips)`
                  : ""}{" "}
                at {(startPeriod.ratePerMile * 100).toFixed(0)}&cent;
              </span>
              <span>
                $
                {(
                  Math.round(totalMiles * startPeriod.ratePerMile * 100) / 100
                ).toFixed(2)}
              </span>
            </div>
            {parkingAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Parking and tolls</span>
                <span>${parkingAmount.toFixed(2)}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex justify-between font-medium">
              <span>Claimable</span>
              <span>${preview.toFixed(2)}</span>
            </div>
          </div>
        )}

        {startPeriod && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {startPeriod.confirmed ? (
                <>
                  Using the IRS rate of{" "}
                  {(startPeriod.ratePerMile * 100).toFixed(0)}&cent; a mile,
                  which applies to care received between {startPeriod.start} and{" "}
                  {startPeriod.end} ({startPeriod.source}).
                </>
              ) : (
                <>
                  <strong>Provisional rate.</strong> We&rsquo;re using{" "}
                  {(startPeriod.ratePerMile * 100).toFixed(0)}&cent; a mile,
                  carried over from the previous year, because the official rate
                  for this period hasn&rsquo;t been entered yet. The rate is
                  saved with the trip, so it can be corrected later without
                  redoing your work.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving || blocked}
            className="flex-1"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving&hellip;
              </>
            ) : (
              "Save trip"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
