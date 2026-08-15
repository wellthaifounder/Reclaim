// Workstream C3 — rules management.
//
// The spec's requirement, verbatim: "A rules management screen: list, edit,
// delete, and see what each rule has affected. Today the app silently writes
// vendor preferences with no UI and no way to undo a mislabel — that must not
// survive."
//
// Every destructive action here reverts before it mutates, so a rule can always
// be taken back off the transactions it touched.

import { useState } from "react";
import { toast } from "sonner";
import {
  useCategorizationRules,
  type CategorizationRuleWithImpact,
} from "@/hooks/useCategorizationRules";
import { MATCH_TYPE_LABELS } from "@/lib/merchantNormalize";
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
import { Loader2, Trash2, Undo2, RefreshCw, ScrollText } from "lucide-react";

function RuleRow({
  rule,
  onToggle,
  onRevert,
  onApply,
  onDelete,
  busy,
}: {
  rule: CategorizationRuleWithImpact;
  onToggle: (isMedical: boolean) => void;
  onRevert: () => void;
  onApply: () => void;
  onDelete: () => void;
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
  const { rules, isLoading, applyRule, revertRule, updateRule, deleteRule } =
    useCategorizationRules();
  const [pendingDelete, setPendingDelete] =
    useState<CategorizationRuleWithImpact | null>(null);

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
            `Rule updated — ${count} transaction${count === 1 ? "" : "s"} recategorized`,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" />
          Categorization rules
        </CardTitle>
        <CardDescription>
          Rules decide medical vs. non-medical automatically. Every rule can be
          undone, and undoing restores each transaction to exactly what it was
          before the rule ran.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
              rule so you never have to decide about that merchant again.
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
            />
          ))
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Updating transactions&hellip;
          </p>
        )}
      </CardContent>

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
    </Card>
  );
}
