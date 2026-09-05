// Workstream C4 — merchant-grouped review feed.
//
// Spec: "Merchant-grouped bulk review: '18 transactions from Walgreens —
// medical?'" and "Every auto-decision shows why. Audit-anxious users need the
// reasoning visible, and it makes disagreement actionable rather than
// mysterious."
//
// Replaces the one-at-a-time queue. Deciding a merchant clears every pending
// transaction from it in a single action, and offers a rule so the question
// never comes back.

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  useReviewFeed,
  groupRuleKey,
  type ReviewGroup,
} from "@/hooks/useReviewFeed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  PartyPopper,
  Loader2,
  Store,
} from "lucide-react";
import {
  CreateRulePrompt,
  type RuleCandidate,
} from "@/components/transactions/CreateRulePrompt";

function GroupRow({
  group,
  onDecide,
  busy,
}: {
  group: ReviewGroup;
  onDecide: (isMedical: boolean) => void;
  busy: boolean;
}) {
  const many = group.txn_count > 1;
  const dateRange =
    group.earliest_date === group.latest_date
      ? format(new Date(group.latest_date), "MMM d, yyyy")
      : `${format(new Date(group.earliest_date), "MMM yyyy")} – ${format(
          new Date(group.latest_date),
          "MMM yyyy",
        )}`;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="font-medium truncate">{group.display_name}</p>
            {many && (
              <Badge variant="secondary" className="text-xs">
                {group.txn_count} transactions
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            <Money value={group.total_amount} />
            {many ? " total" : ""} &middot; {dateRange}
          </p>

          {group.explanation && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <HelpCircle
                className="mt-0.5 h-3 w-3 shrink-0"
                aria-hidden="true"
              />
              <span>{group.explanation}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(true)}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {many ? "All medical" : "Medical"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            <XCircle className="mr-1 h-4 w-4" />
            Not medical
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReviewFeed() {
  const { groups, totalPending, isLoading, decideGroup } = useReviewFeed();
  const [ruleCandidate, setRuleCandidate] = useState<RuleCandidate | null>(
    null,
  );

  const handleDecide = (group: ReviewGroup, isMedical: boolean) => {
    decideGroup.mutate(
      { merchantKey: group.merchant_key, isMedical },
      {
        onSuccess: (count) => {
          toast.success(
            count === 1
              ? `Marked as ${isMedical ? "medical" : "not medical"}`
              : `${count} transactions marked as ${
                  isMedical ? "medical" : "not medical"
                }`,
          );
          // Offer a rule so this merchant stops appearing. The prompt reads
          // the same fields a transaction would expose, so hand it the
          // group's agreed-on keys.
          const key = groupRuleKey(group);
          if (key) {
            setRuleCandidate({
              merchant_entity_id: group.merchant_entity_id,
              merchant_category_code: group.mcc,
              vendor: group.display_name,
              description: group.display_name,
              isMedical,
            });
          }
        },
        onError: () => toast.error("Could not update those transactions"),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <PartyPopper className="h-8 w-8 text-primary" />
          <p className="font-medium">Nothing to review</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Everything that looked medical has been sorted. Transactions that
            clearly aren&rsquo;t medical are filed automatically — you can find
            them under All transactions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {totalPending} transaction{totalPending === 1 ? "" : "s"} to review
          </CardTitle>
          <CardDescription>
            Grouped by merchant so one answer covers all of them. Only
            transactions that look medical appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.map((group) => (
            <GroupRow
              key={group.merchant_key}
              group={group}
              busy={decideGroup.isPending}
              onDecide={(isMedical) => handleDecide(group, isMedical)}
            />
          ))}
          {decideGroup.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating&hellip;
            </p>
          )}
        </CardContent>
      </Card>

      <CreateRulePrompt
        candidate={ruleCandidate}
        onOpenChange={(open) => !open && setRuleCandidate(null)}
      />
    </>
  );
}
