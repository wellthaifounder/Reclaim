// Workstream C3 — "learn from the first decision".
//
// Spec: "You marked CVS as medical. Apply to 47 past and all future CVS
// transactions? — retroactive apply is the point."
//
// This replaces three call sites that silently upserted a vendor preference
// with no prompt, no visible count, and no way to undo. The user now sees the
// blast radius before agreeing to it, and can decline the rule while keeping
// the single-transaction decision.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
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
  const [applyRetroactively, setApplyRetroactively] = useState(true);
  const [pastCount, setPastCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const key = candidate ? suggestRuleKey(candidate) : null;
  const label = candidate?.vendor || candidate?.description || "this merchant";
  const verdict = candidate?.isMedical ? "medical" : "not medical";

  useEffect(() => {
    if (!candidate || !key) {
      setPastCount(null);
      return;
    }
    let cancelled = false;
    setCounting(true);
    setApplyRetroactively(true);
    previewImpact(key.matchType, key.matchValue)
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
          onOpenChange(false);
          onCreated?.();
        },
        onError: () => toast.error("Could not save the rule"),
      },
    );
  };

  // No usable key means no rule is possible — a descriptor with no letters or
  // digits at all. Say nothing rather than offering a rule that cannot match.
  const open = !!candidate && !!key;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remember this for {label}?</DialogTitle>
          <DialogDescription>
            You marked {label} as {verdict}. We can apply that automatically
            from now on so you never have to decide about this merchant again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                  "Also apply to past transactions from this merchant"
                ) : pastCount === 0 ? (
                  "No past transactions from this merchant to update"
                ) : (
                  `Also apply to ${pastCount} past transaction${
                    pastCount === 1 ? "" : "s"
                  }`
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                You can undo this at any time from Categorization rules.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Just this once
          </Button>
          <Button onClick={handleCreate} disabled={createRule.isPending}>
            {createRule.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { RuleMatchType };
