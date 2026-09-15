// Workstream C3 — rules management.
//
// The spec's requirement, verbatim: "A rules management screen: list, edit,
// delete, and see what each rule has affected. Today the app silently writes
// vendor preferences with no UI and no way to undo a mislabel — that must not
// survive."
//
// Every destructive action here reverts before it mutates, so a rule can always
// be taken back off the transactions it touched.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useCategorizationRules,
  type CategorizationRuleWithImpact,
} from "@/hooks/useCategorizationRules";
import {
  MATCH_TYPE_LABELS,
  MATCH_OPERATOR_LABELS,
  normalizeMerchantName,
  type RuleMatchOperator,
} from "@/lib/merchantNormalize";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Plus,
  Trash2,
  Undo2,
  RefreshCw,
  ScrollText,
  TriangleAlert,
} from "lucide-react";

const MATCH_OPERATORS: RuleMatchOperator[] = [
  "is_exactly",
  "starts_with",
  "contains",
];

/**
 * Spec D22/D23. Only rendered for match_type 'name_pattern' — an
 * entity or mcc rule always matches on exact equality of that one signal, so
 * there's no operator to choose. Picking a new operator here is staged
 * locally first, not applied on every keystroke of the dropdown: switching
 * to "Contains" fetches and shows up to five real merchant names it would
 * catch (D23's whole reason for existing — a count can't warn you that
 * "contains: med" also catches Mediterranean Grill) before the choice is
 * saved, mirroring the same revert-first treatment as the Medical/Not
 * medical switch above it.
 */
function NameOperatorEditor({
  rule,
  onSave,
  previewMatchingNames,
  busy,
}: {
  rule: CategorizationRuleWithImpact;
  onSave: (operator: RuleMatchOperator) => void;
  previewMatchingNames: (
    matchType: CategorizationRuleWithImpact["match_type"],
    matchValue: string,
    matchOperator: RuleMatchOperator,
  ) => Promise<string[]>;
  busy: boolean;
}) {
  const [pending, setPending] = useState<RuleMatchOperator>(
    rule.match_operator,
  );
  const [previewNames, setPreviewNames] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const dirty = pending !== rule.match_operator;

  // A rule saved elsewhere (another tab, the Undo button) should reset any
  // uncommitted local pick rather than silently keep offering to save a
  // choice that no longer reflects what's on screen.
  useEffect(() => {
    setPending(rule.match_operator);
  }, [rule.match_operator]);

  useEffect(() => {
    if (pending !== "contains") {
      setPreviewNames(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    previewMatchingNames(rule.match_type, rule.match_value, "contains")
      .then((names) => {
        if (!cancelled) setPreviewNames(names);
      })
      .catch(() => {
        if (!cancelled) setPreviewNames(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pending, rule.match_type, rule.match_value, previewMatchingNames]);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Matches when it</span>
        <Select
          value={pending}
          disabled={busy}
          onValueChange={(v) => setPending(v as RuleMatchOperator)}
        >
          <SelectTrigger className="h-7 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MATCH_OPERATORS.map((op) => (
              <SelectItem key={op} value={op} className="text-xs">
                {MATCH_OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dirty && (
          <>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => onSave(pending)}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => setPending(rule.match_operator)}
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      {pending === "contains" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">
              Contains matches anywhere in the name, not just the start.
            </p>
            {previewLoading ? (
              <p className="mt-1 flex items-center gap-1.5 opacity-80">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking what this would catch&hellip;
              </p>
            ) : previewNames && previewNames.length > 0 ? (
              <p className="mt-1 opacity-90">
                Catches: {previewNames.join(", ")}
                {previewNames.length === 5 ? "…" : ""}
              </p>
            ) : previewNames ? (
              <p className="mt-1 opacity-90">
                Doesn&rsquo;t currently match any of your transactions.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Spec D24: the panel's own create path, rather than the only way to make a
 * rule being to categorize a transaction and accept the "remember this?"
 * offer (CreateRulePrompt.tsx). Scoped to name_pattern rules only — the kind
 * a person can describe by typing a merchant name. merchant_entity and mcc
 * rules key off Plaid's own opaque id and a four-digit code respectively;
 * asking someone to type either by hand isn't a real create path, and the
 * existing offer-after-deciding flow already produces those correctly from
 * a real transaction's identifiers.
 */
function CreateRuleDialog({
  open,
  onOpenChange,
  onCreate,
  previewImpact,
  previewMatchingNames,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    matchValue: string;
    displayLabel: string;
    matchOperator: RuleMatchOperator;
    isMedical: boolean;
    applyRetroactively: boolean;
  }) => void;
  previewImpact: (
    matchType: "name_pattern",
    matchValue: string,
    isMedical: boolean,
    matchOperator: RuleMatchOperator,
  ) => Promise<number>;
  previewMatchingNames: (
    matchType: "name_pattern",
    matchValue: string,
    matchOperator: RuleMatchOperator,
  ) => Promise<string[]>;
  busy: boolean;
}) {
  const [rawName, setRawName] = useState("");
  const [operator, setOperator] = useState<RuleMatchOperator>("starts_with");
  const [isMedical, setIsMedical] = useState(true);
  const [applyRetroactively, setApplyRetroactively] = useState(false);
  const [impactCount, setImpactCount] = useState<number | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [containsNames, setContainsNames] = useState<string[] | null>(null);
  const [containsLoading, setContainsLoading] = useState(false);

  const matchValue = normalizeMerchantName(rawName);

  const reset = () => {
    setRawName("");
    setOperator("starts_with");
    setIsMedical(true);
    setApplyRetroactively(false);
    setImpactCount(null);
    setContainsNames(null);
  };

  // Debounced so a rule preview doesn't fire an RPC on every keystroke.
  useEffect(() => {
    if (!matchValue) {
      setImpactCount(null);
      return;
    }
    let cancelled = false;
    setImpactLoading(true);
    const timer = setTimeout(() => {
      previewImpact("name_pattern", matchValue, isMedical, operator)
        .then((count) => {
          if (!cancelled) setImpactCount(count);
        })
        .catch(() => {
          if (!cancelled) setImpactCount(null);
        })
        .finally(() => {
          if (!cancelled) setImpactLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchValue, isMedical, operator, previewImpact]);

  useEffect(() => {
    if (operator !== "contains" || !matchValue) {
      setContainsNames(null);
      return;
    }
    let cancelled = false;
    setContainsLoading(true);
    previewMatchingNames("name_pattern", matchValue, "contains")
      .then((names) => {
        if (!cancelled) setContainsNames(names);
      })
      .catch(() => {
        if (!cancelled) setContainsNames(null);
      })
      .finally(() => {
        if (!cancelled) setContainsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operator, matchValue, previewMatchingNames]);

  const handleSubmit = () => {
    if (!matchValue) return;
    onCreate({
      matchValue,
      displayLabel: rawName.trim(),
      matchOperator: operator,
      isMedical,
      applyRetroactively,
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>
            Charges from a merchant matching this get categorized automatically
            from now on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-rule-name">Merchant name</Label>
            <Input
              id="new-rule-name"
              placeholder="e.g. Walgreens"
              value={rawName}
              onChange={(e) => setRawName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Matches when the name</Label>
            <Select
              value={operator}
              onValueChange={(v) => setOperator(v as RuleMatchOperator)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATCH_OPERATORS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {MATCH_OPERATOR_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {operator === "contains" && matchValue && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">
                  Contains matches anywhere in the name, not just the start.
                </p>
                {containsLoading ? (
                  <p className="mt-1 flex items-center gap-1.5 opacity-80">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking what this would catch&hellip;
                  </p>
                ) : containsNames && containsNames.length > 0 ? (
                  <p className="mt-1 opacity-90">
                    Catches: {containsNames.join(", ")}
                    {containsNames.length === 5 ? "…" : ""}
                  </p>
                ) : containsNames ? (
                  <p className="mt-1 opacity-90">
                    Doesn&rsquo;t currently match any of your transactions.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="new-rule-medical">Medical</Label>
              <p className="text-xs text-muted-foreground">
                Off marks these as not medical instead.
              </p>
            </div>
            <Switch
              id="new-rule-medical"
              checked={isMedical}
              onCheckedChange={setIsMedical}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={applyRetroactively}
              onCheckedChange={(checked) =>
                setApplyRetroactively(checked === true)
              }
              disabled={!matchValue}
            />
            <span>
              Also apply to past transactions
              {matchValue &&
                (impactLoading
                  ? "…"
                  : impactCount !== null
                    ? ` (${impactCount} match${impactCount === 1 ? "" : "es"} now)`
                    : "")}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!matchValue || busy}>
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One sentence of explanation, exported so the Settings section describes
 * rules the same way every time it's read. Two hand-written
 * copies is how the same feature ends up with two different promises about
 * whether Apply can be undone.
 */
export const RULES_BLURB =
  "Rules decide medical vs. non-medical automatically for new transactions. They never change transactions you have already categorized unless you press Apply — and Apply can always be undone, which puts every transaction back exactly as it was.";

function RuleRow({
  rule,
  onToggle,
  onRevert,
  onApply,
  onDelete,
  onUpdateOperator,
  previewMatchingNames,
  busy,
}: {
  rule: CategorizationRuleWithImpact;
  onToggle: (isMedical: boolean) => void;
  onRevert: () => void;
  onApply: () => void;
  onDelete: () => void;
  onUpdateOperator: (operator: RuleMatchOperator) => void;
  previewMatchingNames: (
    matchType: CategorizationRuleWithImpact["match_type"],
    matchValue: string,
    matchOperator: RuleMatchOperator,
  ) => Promise<string[]>;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium truncate">
            {rule.display_label || rule.match_value}
          </p>
          <Badge variant="outline" className="text-xs">
            {MATCH_TYPE_LABELS[rule.match_type]}
          </Badge>
          <Badge
            variant={rule.is_medical ? "default" : "secondary"}
            className="text-xs"
          >
            {rule.is_medical ? "Medical" : "Not medical"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {rule.affectedCount === 0
            ? "Not currently applied to any transactions"
            : `Applied to ${rule.affectedCount} transaction${
                rule.affectedCount === 1 ? "" : "s"
              }`}
          {rule.match_type === "name_pattern" && (
            <span className="ml-1 opacity-70">
              &middot; matches &ldquo;{rule.match_value}&rdquo;
            </span>
          )}
        </p>
        {rule.match_type === "name_pattern" && (
          <NameOperatorEditor
            rule={rule}
            onSave={onUpdateOperator}
            previewMatchingNames={previewMatchingNames}
            busy={busy}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 pr-2">
          <span className="text-xs text-muted-foreground">Medical</span>
          <Switch
            checked={rule.is_medical}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={`Mark ${rule.display_label || rule.match_value} as medical`}
          />
        </div>
        {rule.affectedCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onRevert}
            title="Undo this rule on every transaction it changed"
          >
            <Undo2 className="mr-1 h-4 w-4" />
            Undo
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onApply}
            title="Apply this rule to matching past transactions"
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Apply
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete rule"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export function CategorizationRulesManager() {
  const {
    rules,
    isLoading,
    applyRule,
    revertRule,
    updateRule,
    deleteRule,
    createRule,
    previewImpact,
    previewMatchingNames,
  } = useCategorizationRules();
  const [pendingDelete, setPendingDelete] =
    useState<CategorizationRuleWithImpact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const busy =
    applyRule.isPending ||
    revertRule.isPending ||
    updateRule.isPending ||
    deleteRule.isPending;

  const handleToggle = (rule: CategorizationRuleWithImpact, next: boolean) => {
    updateRule.mutate(
      { id: rule.id, isMedical: next },
      {
        onSuccess: (count) =>
          toast.success(
            count === 0
              ? "Rule updated"
              : `Rule updated. ${count} transaction${
                  count === 1 ? " was" : "s were"
                } put back to how it was before — press Apply to use the new setting on them.`,
          ),
        onError: () => toast.error("Could not update the rule"),
      },
    );
  };

  const handleUpdateOperator = (
    rule: CategorizationRuleWithImpact,
    operator: RuleMatchOperator,
  ) => {
    updateRule.mutate(
      { id: rule.id, matchOperator: operator },
      {
        onSuccess: (count) =>
          toast.success(
            count === 0
              ? "Rule updated"
              : `Rule updated. ${count} transaction${
                  count === 1 ? " was" : "s were"
                } put back to how it was before — press Apply to use the new setting on them.`,
          ),
        onError: () => toast.error("Could not update the rule"),
      },
    );
  };

  const handleRevert = (rule: CategorizationRuleWithImpact) => {
    revertRule.mutate(rule.id, {
      onSuccess: (count) =>
        toast.success(
          `Undone — ${count} transaction${count === 1 ? "" : "s"} restored`,
        ),
      onError: () => toast.error("Could not undo the rule"),
    });
  };

  const handleApply = (rule: CategorizationRuleWithImpact) => {
    applyRule.mutate(rule.id, {
      onSuccess: (count) =>
        toast.success(
          count === 0
            ? "No past transactions matched this rule"
            : `Applied to ${count} transaction${count === 1 ? "" : "s"}`,
        ),
      onError: () => toast.error("Could not apply the rule"),
    });
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const rule = pendingDelete;
    setPendingDelete(null);
    deleteRule.mutate(rule.id, {
      onSuccess: () => toast.success("Rule deleted and its changes undone"),
      onError: () => toast.error("Could not delete the rule"),
    });
  };

  const handleCreate = (input: {
    matchValue: string;
    displayLabel: string;
    matchOperator: RuleMatchOperator;
    isMedical: boolean;
    applyRetroactively: boolean;
  }) => {
    createRule.mutate(
      {
        matchType: "name_pattern",
        matchValue: input.matchValue,
        displayLabel: input.displayLabel,
        matchOperator: input.matchOperator,
        isMedical: input.isMedical,
        applyRetroactively: input.applyRetroactively,
      },
      {
        onSuccess: ({ applied }) => {
          setCreateOpen(false);
          toast.success(
            applied > 0
              ? `Rule created and applied to ${applied} transaction${applied === 1 ? "" : "s"}`
              : "Rule created",
          );
        },
        onError: () => toast.error("Could not create the rule"),
      },
    );
  };

  const body = (
    <>
      {isLoading ? (
        <>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No rules yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When you categorize a transaction, we&rsquo;ll offer to make it a
            rule so you never have to decide about that merchant again — or
            press &ldquo;New rule&rdquo; above to add one yourself.
          </p>
        </div>
      ) : (
        rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            busy={busy}
            onToggle={(next) => handleToggle(rule, next)}
            onRevert={() => handleRevert(rule)}
            onApply={() => handleApply(rule)}
            onDelete={() => setPendingDelete(rule)}
            onUpdateOperator={(op) => handleUpdateOperator(rule, op)}
            previewMatchingNames={previewMatchingNames}
          />
        ))
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating transactions&hellip;
        </p>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && pendingDelete.affectedCount > 0
                ? `The ${pendingDelete.affectedCount} transaction${
                    pendingDelete.affectedCount === 1 ? "" : "s"
                  } this rule changed will be restored to how ${
                    pendingDelete.affectedCount === 1 ? "it was" : "they were"
                  } before. Future transactions from this merchant will go back to being categorized automatically.`
                : "Future transactions from this merchant will go back to being categorized automatically."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateRuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
        previewImpact={previewImpact}
        previewMatchingNames={previewMatchingNames}
        busy={createRule.isPending}
      />
    </>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5" />
              Categorization rules
            </CardTitle>
            <CardDescription>{RULES_BLURB}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{body}</CardContent>
    </Card>
  );
}
