// Workstream C3 — "learn from the first decision".
//
// Spec: "You marked CVS as medical. Apply to 47 past and all future CVS
// transactions? — retroactive apply is the point."
//
// This replaces three call sites that silently upserted a vendor preference
// with no prompt, no visible count, and no way to undo. The user now sees the
// blast radius before agreeing to it, and can decline the rule while keeping
// the single-transaction decision.
//
// 2026-09 (docs/TRANSACTION_REVIEW_SPEC.md, C2):
//
// D20 — the copy used to lead with the past-tense fact ("You marked X as
// healthcare...") and only got to the forward promise afterward. The prompt
// now leads with the promise itself — "From now on, X is healthcare" — since
// that's the sentence that actually sells a brand-new rule; a past-tense
// opener makes a rule for a merchant seen once today read the same as a rule
// for a hundred-transaction history. The backfill count only appears when
// there is one to report; a zero or not-yet-known count says nothing here
// (the checkbox below still explains the zero case on its own).
//
// D21 — this used to be a Radix Dialog: a full-screen scrim, a focus trap,
// and exactly one of it or anything else on screen at a time. That made it
// mutually exclusive with the receipt-offer toast (see ReviewFeed.tsx) even
// though the two rarely have anything to do with each other — the receipt
// offer follows one transaction, this follows a merchant becoming fully
// decided. Rebuilt as a plain, non-modal panel anchored to the opposite
// corner from where Sonner's toasts land (bottom-right by default; see
// src/components/ui/sonner.tsx), so the two can be on screen and both
// usable at once instead of one silently eating the other.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCategorizationRules } from "@/hooks/useCategorizationRules";
import {
  MATCH_TYPE_LABELS,
  suggestRuleKey,
  type RuleMatchType,
} from "@/lib/merchantNormalize";
import { logError } from "@/utils/errorHandler";

export interface RuleCandidate {
  merchant_entity_id?: string | null;
  merchant_category_code?: string | null;
  vendor?: string | null;
  description?: string | null;
  isMedical: boolean;
}

interface CreateRulePromptProps {
  candidate: RuleCandidate | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function CreateRulePrompt({
  candidate,
  onOpenChange,
  onCreated,
}: CreateRulePromptProps) {
  const { previewImpact, createRule } = useCategorizationRules();
  // Defaults OFF. Re-labelling a user's past transactions only ever happens
  // because they ticked this box themselves — never as a side effect of
  // saving a rule, and never pre-selected so a fast click applies it by
  // accident.
  const [applyRetroactively, setApplyRetroactively] = useState(false);
  const [pastCount, setPastCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const key = candidate ? suggestRuleKey(candidate) : null;
  const label = candidate?.vendor || candidate?.description || "this merchant";
  // No usable key means no rule is possible — a descriptor with no letters or
  // digits at all. Say nothing rather than offering a rule that cannot match.
  const open = !!candidate && !!key;
  const panelRef = useRef<HTMLDivElement>(null);

  // Closing sets aria-hidden on the panel (see the wrapper below). If the
  // button just clicked — "Just this once", the X, "Create rule" — still
  // holds keyboard focus at that instant, the browser refuses to hide it
  // ("aria-hidden on an element because its descendant retained focus") and
  // warns in the console. Moving focus off the panel first, in the same
  // event handler, avoids the collision entirely.
  const close = () => {
    if (
      panelRef.current &&
      document.activeElement instanceof HTMLElement &&
      panelRef.current.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    onOpenChange(false);
  };

  useEffect(() => {
    if (!candidate || !key) {
      setPastCount(null);
      return;
    }
    let cancelled = false;
    setCounting(true);
    setApplyRetroactively(false);
    previewImpact(key.matchType, key.matchValue, candidate.isMedical)
      .then((n) => {
        if (!cancelled) setPastCount(n);
      })
      .catch((error) => {
        // A failed count must not block rule creation — it only means we
        // cannot promise a number, so the copy falls back to "past".
        logError("Rule impact preview failed", error);
        if (!cancelled) setPastCount(null);
      })
      .finally(() => {
        if (!cancelled) setCounting(false);
      });
    return () => {
      cancelled = true;
    };
    // previewImpact is stable for the lifetime of the hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.vendor, candidate?.merchant_entity_id, candidate?.isMedical]);

  // Non-modal: Escape still closes it, matching what the Dialog gave for
  // free, but without a focus trap or backdrop stealing the rest of the page.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // close() closes over onOpenChange, which is stable from the caller;
    // re-binding per keystroke isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCreate = () => {
    if (!candidate || !key) return;
    createRule.mutate(
      {
        matchType: key.matchType,
        matchValue: key.matchValue,
        isMedical: candidate.isMedical,
        displayLabel: candidate.vendor ?? candidate.description ?? null,
        applyRetroactively,
      },
      {
        onSuccess: ({ applied }) => {
          toast.success(
            applied > 0
              ? `Rule saved — ${applied} past transaction${
                  applied === 1 ? "" : "s"
                } updated`
              : "Rule saved for future transactions",
          );
          close();
          onCreated?.();
        },
        onError: () => toast.error("Could not save the rule"),
      },
    );
  };

  const forwardPromise = candidate?.isMedical
    ? `From now on, charges from ${label} are healthcare`
    : `From now on, we'll stop flagging ${label}`;

  const panel = (
    <div
      ref={panelRef}
      className={cn(
        // Sonner has no explicit `position` (src/components/ui/sonner.tsx),
        // so its default toasts anchor bottom-right but stretch close to
        // full width on a narrow screen — the same footprint this panel
        // uses below `sm`. bottom-20 clears a stacked toast or two; sm and up
        // reverts to bottom-4 since the toast column is narrow there and the
        // two corners never overlap.
        "fixed inset-x-4 bottom-20 z-50 transition-all duration-200 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-96",
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
      role="region"
      aria-label={`Suggested rule for ${label}`}
      aria-hidden={!open}
    >
      <Card className="space-y-4 p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium leading-snug">{forwardPromise}</p>
            {/* D20: the backfill count only shows up here when there is one
                to report — a zero or still-loading count says nothing, so a
                brand-new merchant's rule reads as pure upside. */}
            {!counting && pastCount !== null && pastCount > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                We can also catch the {pastCount} past transaction
                {pastCount === 1 ? "" : "s"} like it.
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={close}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            Matching on: {key ? MATCH_TYPE_LABELS[key.matchType] : ""}
          </p>
          <p className="mt-1 text-muted-foreground break-words">
            {key?.matchValue}
          </p>
          {key?.matchType === "mcc" && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
              This merchant has no usable name, so the rule matches its whole
              merchant category — it may affect other merchants too.
            </p>
          )}
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="apply-retroactively"
            checked={applyRetroactively}
            onCheckedChange={(v) => setApplyRetroactively(v === true)}
            disabled={counting || pastCount === 0}
          />
          <div className="grid gap-1 leading-none">
            <Label
              htmlFor="apply-retroactively"
              className="cursor-pointer font-normal"
            >
              {counting ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking past transactions&hellip;
                </span>
              ) : pastCount === null ? (
                "Also re-label past transactions from this merchant"
              ) : pastCount === 0 ? (
                // True whether the merchant has no other transactions or
                // several that already carry this verdict. The old copy said
                // "no past transactions from this merchant", which was a
                // claim about the merchant rather than about the rule, and
                // was simply false in the second case.
                "No past transactions need re-labelling"
              ) : (
                `Also re-label ${pastCount} past transaction${
                  pastCount === 1 ? "" : "s"
                }`
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {pastCount && pastCount > 0
                ? "This changes transactions you have already categorized. You can undo it at any time from Settings → Categorization rules."
                : pastCount === 0
                  ? "The rule still applies to everything from here on."
                  : "Leave this unticked and the rule only affects transactions from here on."}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Just this once
          </Button>
          <Button onClick={handleCreate} disabled={createRule.isPending}>
            {createRule.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create rule
          </Button>
        </div>
      </Card>
    </div>
  );

  // Portalled to the body, same as Sonner's own toasts, so a scrolling or
  // overflow-hidden ancestor further up the page can never clip it.
  return typeof document !== "undefined"
    ? createPortal(panel, document.body)
    : null;
}

export type { RuleMatchType };
