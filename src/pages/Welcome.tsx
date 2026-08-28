// Step 0 — "Connect first, configure second".
//
// The order here is the entire point, and it is a reversal of what the app did
// before. From the workflow spec:
//
//   "Asking for HSA establishment date and family roster before showing any
//    value is the highest drop-off point in the funnel. Connect accounts -> run
//    the historical lookback -> show 'We found 47 likely-medical transactions
//    totalling $3,240' -> THEN collect the details needed to act on them."
//
// So this page asks for exactly one thing up front: connect a bank. Everything
// else waits until after /onboarding/import has shown the user their own money.
//
// What was here before: nothing. Three onboarding components existed on disk
// (OnboardingWizard, WelcomeDialog, EmptyStateOnboarding) and no route or page
// rendered any of them. A new user landed on an empty dashboard with two
// manual-entry buttons, in a product whose premise is bank sync, and was never
// asked for their HSA date, their household, or their strategy at all.
//
// Every question after the first is skippable, and skipping is not a failure
// state -- each one is asked again later at the point where it actually blocks
// something. The timing gate asks for the HSA date when it needs it;
// substantiation asks who an expense was for when it needs that. Front-loading
// homework buys nothing that asking in context does not.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { FocusedLayout } from "@/components/FocusedLayout";
import { PlaidLink } from "@/components/PlaidLink";
import { FamilyRosterCard } from "@/components/family/FamilyRosterCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Landmark,
  CalendarIcon,
  Users,
  PiggyBank,
  Wallet,
  ArrowRight,
  ShieldCheck,
  Search,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logError } from "@/utils/errorHandler";
import { useRecomputeTiming } from "@/hooks/useHSAEligibility";
import { useSetOnboardingComplete } from "@/hooks/useOnboardingStatus";
import type { ReimbursementStrategy } from "@/hooks/useReimbursementStrategy";

// Ordered. `connect` is the only one that runs before the user has seen what
// Reclaim found; the rest are the "configure second" half.
const STEPS = ["connect", "household", "hsa", "strategy"] as const;
type Step = (typeof STEPS)[number];

function isStep(v: string | null): v is Step {
  return !!v && (STEPS as readonly string[]).includes(v);
}

// HSAs were created by the Medicare Prescription Drug, Improvement, and
// Modernization Act of 2003 and could first be opened on 1 January 2004. No
// one's HSA predates that, so the year list stops there rather than running
// back to an arbitrary round number.
const FIRST_HSA_YEAR = 2004;

export default function Welcome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const setComplete = useSetOnboardingComplete();
  const recomputeTiming = useRecomputeTiming();

  const stepParam = searchParams.get("step");
  const step: Step = isStep(stepParam) ? stepParam : "connect";
  const stepIndex = STEPS.indexOf(step);

  const goTo = (next: Step) => {
    setSearchParams({ step: next }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const finish = async (destination: string) => {
    try {
      await setComplete.mutateAsync(true);
    } catch {
      // Already logged by the mutation. Stamping setup complete failing is not
      // a reason to trap someone on the welcome screen -- send them into the
      // app. Worst case they see this flow once more.
    }
    navigate(destination, { replace: true });
  };

  return (
    <FocusedLayout
      exitLabel="Skip setup"
      // Leaving early is allowed and stamps setup complete, so the flow does
      // not reappear on the next sign-in. Every question it skipped gets asked
      // again where it actually blocks something.
      onExit={() => finish("/dashboard")}
    >
      <div className="max-w-xl mx-auto px-4 py-4 sm:py-8">
        {/* Progress. Hidden on the first step: showing someone a four-step
            progress bar before they have agreed to step one advertises how
            much work is ahead, which is the drop-off the spec is about. */}
        {stepIndex > 0 && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === stepIndex
                    ? "w-8 bg-primary"
                    : i < stepIndex
                      ? "w-4 bg-primary/40"
                      : "w-4 bg-muted",
                )}
              />
            ))}
          </div>
        )}

        {step === "connect" && <ConnectStep onSkip={() => goTo("household")} />}

        {step === "household" && <HouseholdStep onNext={() => goTo("hsa")} />}

        {step === "hsa" && (
          <HsaDateStep
            onNext={() => goTo("strategy")}
            onSaved={async () => {
              // The cliff moves the moment a date lands, in both directions.
              // Without this the user sets their date and the expenses it
              // should have unblocked stay blocked until something else
              // happens to trigger a recompute.
              try {
                await recomputeTiming.mutateAsync();
              } catch {
                // Logged in the hook. The date itself saved, which is the part
                // that matters; the recompute runs again on the next edit.
              }
            }}
          />
        )}

        {step === "strategy" && (
          <StrategyStep
            onDone={async () => {
              await queryClient.invalidateQueries({
                queryKey: ["reimbursement-strategy"],
              });
              // Someone who has connected a bank has transactions waiting to be
              // categorised, so the review feed is the useful landing. Someone
              // who skipped connecting has nothing there and is sent to the
              // dashboard instead, where the "add an expense" buttons live.
              const hasBank = await userHasBank();
              await finish(hasBank ? "/expenses" : "/dashboard");
            }}
          />
        )}
      </div>
    </FocusedLayout>
  );
}

async function userHasBank(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("plaid_connections")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Step 1: connect ─────────────────────────────────────────────────────────

function ConnectStep({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10">
          <Landmark className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-balance">
          Let's find the money you've already spent
        </h1>
        <p className="text-muted-foreground">
          Connect the accounts you pay medical bills from. Reclaim reads up to
          18 months of history and finds the healthcare spending you can still
          reimburse yourself for.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          {/* Why a bank and not a receipt: your card statement is the only
              record of what you ACTUALLY paid after insurance. This is the
              product's central argument and belongs in front of the button
              asking for bank credentials. */}
          <Point
            icon={Search}
            title="Your statement knows what insurance left you"
            body="A bill shows what was charged and an EOB shows what was allowed. Only the transaction shows what actually came out of your pocket — and that's the number you can claim."
          />
          <Point
            icon={ShieldCheck}
            title="Read-only, and we never see your login"
            body="The connection is handled by Plaid. Reclaim receives transaction records — it can't move money and never sees your bank password."
          />
          <Point
            icon={Wallet}
            title="Include your HSA if you have one"
            body="Connecting it lets Reclaim tell a bill you paid with the HSA card from one you paid out of pocket. Only the second kind can be reimbursed, and mixing them up is the costliest mistake in an HSA."
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <PlaidLink />
        <Button variant="ghost" onClick={onSkip}>
          I'd rather add expenses myself
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        You can connect a bank later from Settings. Nothing is marked eligible
        without you confirming it.
      </p>
    </div>
  );
}

function Point({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
      </div>
    </div>
  );
}

// ── Step 2: household ───────────────────────────────────────────────────────

function HouseholdStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10">
          <Users className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-balance">
          Who else do you pay medical bills for?
        </h1>
        {/* The age-26 trap, stated plainly. Health-plan coverage and tax
            dependency are different things, and only dependency makes someone's
            expenses HSA-eligible. */}
        <p className="text-muted-foreground">
          Your own and your spouse's expenses always qualify. For anyone else,
          what matters is whether you claim them on your taxes — not whether
          they're on your health plan. Those aren't the same thing.
        </p>
      </div>

      <FamilyRosterCard />

      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={onNext}>
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button variant="ghost" onClick={onNext}>
          It's just me
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: HSA establishment date ──────────────────────────────────────────

function HsaDateStep({
  onNext,
  onSaved,
}: {
  onNext: () => void;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"exact" | "unsure">("exact");
  const [date, setDate] = useState<Date>();
  const [year, setYear] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const out: number[] = [];
    for (let y = now; y >= FIRST_HSA_YEAR; y--) out.push(y);
    return out;
  }, []);

  const canSave = mode === "exact" ? !!date : !!year;

  const save = async () => {
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // "I'm not sure" resolves to 1 January of the chosen year. That is the
      // permissive end: it lets through expenses that a real establishment date
      // later in the year would exclude. The alternative -- 31 December --
      // would block eleven months of legitimately claimable spending and read
      // as the app being broken. So we take the permissive end AND record that
      // it is a guess, so the warning can follow the user to the point where
      // they are about to file a claim on the strength of it.
      const isEstimate = mode === "unsure";
      const value = isEstimate ? `${year}-01-01` : format(date!, "yyyy-MM-dd");

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          hsa_opened_date: value,
          hsa_opened_date_is_estimate: isEstimate,
        },
        { onConflict: "id" },
      );
      if (error) throw error;

      await onSaved();
      toast.success(
        isEstimate
          ? `Saved as January 1, ${year}. Confirm the exact date with your HSA provider before you file a claim.`
          : "HSA date saved.",
      );
      onNext();
    } catch (error) {
      logError("Saving HSA establishment date failed", error);
      toast.error("We couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10">
          <CalendarIcon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-balance">
          When did you open your HSA?
        </h1>
        <p className="text-muted-foreground">
          Care you received before that day can never be paid from your HSA —
          not with any amount of paperwork. It's the one date that decides what
          you're allowed to claim.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "exact" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setMode("exact")}
            >
              I know the date
            </Button>
            <Button
              variant={mode === "unsure" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setMode("unsure")}
            >
              I'm not sure
            </Button>
          </div>

          {mode === "exact" ? (
            <div className="space-y-1.5">
              <Label htmlFor="hsa-opened-date" className="text-xs">
                Date your HSA was opened
              </Label>
              <DateField
                id="hsa-opened-date"
                aria-label="Date your HSA was opened"
                value={date}
                onChange={setDate}
                fromDate={new Date(FIRST_HSA_YEAR, 0, 1)}
                toDate={new Date()}
                outOfRangeMessage={`HSAs didn't exist before ${FIRST_HSA_YEAR}, and the date can't be in the future.`}
              />
              <p className="text-xs text-muted-foreground">
                Type it, or use the calendar.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Roughly which year?" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {year && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    We'll assume January 1, {year}. If your HSA actually opened
                    later that year, Reclaim may show expenses as claimable that
                    aren't. Your HSA provider can tell you the exact date —
                    worth confirming before you file.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={save} disabled={!canSave || saving}>
          {saving ? "Saving…" : "Continue"}
          {!saving && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
        <Button variant="ghost" onClick={onNext} disabled={saving}>
          I'll find it later
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: reimbursement strategy ──────────────────────────────────────────

function StrategyStep({
  onDone,
}: {
  onDone: (strategy: ReimbursementStrategy) => Promise<void>;
}) {
  const [choice, setChoice] = useState<ReimbursementStrategy>("regular");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, reimbursement_strategy_preference: choice },
          { onConflict: "id" },
        );
      if (error) throw error;
    } catch (error) {
      logError("Saving reimbursement strategy failed", error);
      // Not fatal: 'regular' is the column default and the safe one, and the
      // setting is a click away in Settings. Blocking the end of onboarding
      // over a preference would be worse than proceeding with the default.
      toast.error("We couldn't save that preference — you can set it later.");
    } finally {
      setSaving(false);
    }
    await onDone(choice);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10">
          <PiggyBank className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-balance">
          How do you want to use your HSA?
        </h1>
        <p className="text-muted-foreground">
          There's no deadline on HSA reimbursement. Both of these are valid —
          this only changes whether Reclaim treats a documented expense as
          something still to do, or as finished.
        </p>
      </div>

      <div className="space-y-3">
        <StrategyOption
          selected={choice === "regular"}
          onSelect={() => setChoice("regular")}
          icon={Wallet}
          title="Reimburse as I go"
          body="Claim your money back regularly. Reclaim reminds you when expenses are documented and ready to submit."
        />
        {/* The shoebox strategy is a terminal SUCCESS state in the spec, not an
            incomplete one. A product that tells someone they have 40 unfinished
            items when they have deliberately finished all 40 is telling them
            they are doing it wrong. */}
        <StrategyOption
          selected={choice === "shoebox"}
          onSelect={() => setChoice("shoebox")}
          icon={PiggyBank}
          title="Let it grow, claim later"
          body="Pay out of pocket now and let the HSA compound tax-free — you keep the receipts and reimburse yourself years from now. Reclaim will hold your paper trail and won't nag you to submit."
        />
      </div>

      <Button size="lg" className="w-full" onClick={save} disabled={saving}>
        {saving ? "Finishing…" : "Finish setup"}
        {!saving && <ArrowRight className="ml-2 h-4 w-4" />}
      </Button>
    </div>
  );
}

function StrategyOption({
  selected,
  onSelect,
  icon: Icon,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/50",
      )}
    >
      <div className="flex gap-3">
        <Icon
          className={cn(
            "h-5 w-5 shrink-0 mt-0.5",
            selected ? "text-primary" : "text-muted-foreground",
          )}
        />
        <div>
          <p className="font-medium text-sm">{title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
        </div>
      </div>
    </button>
  );
}
