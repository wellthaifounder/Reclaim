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

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  useReviewFeed,
  groupRuleKey,
  type ReviewGroup,
} from "@/hooks/useReviewFeed";
import { supabase } from "@/integrations/supabase/client";
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
  Split,
} from "lucide-react";
import {
  CreateRulePrompt,
  type RuleCandidate,
} from "@/components/transactions/CreateRulePrompt";
import { ExpenseSplitDialog } from "@/components/transactions/ExpenseSplitDialog";

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

/**
 * A grocery/general-merchandise/warehouse-club group. is_medical is false on
 * every row here — nothing in this lane ever moves a total or creates an
 * expense on its own. The only actions are dismissing the whole group as
 * having had nothing medical in it, or, when the group is exactly one
 * transaction, splitting the medical portion out of that one basket.
 */
function OtcGroupRow({
  group,
  onDismiss,
  onSplit,
  busy,
}: {
  group: ReviewGroup;
  onDismiss: () => void;
  onSplit: () => void;
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

          {many && (
            <p className="mt-2 text-xs text-muted-foreground">
              These vary trip to trip — open one under All transactions to split
              out anything medical from it.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
          {group.single_transaction_id && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onSplit}
            >
              <Split className="mr-1 h-4 w-4" />
              Split out medical items
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
            <XCircle className="mr-1 h-4 w-4" />
            {many ? "None had medical items" : "No medical items here"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReviewFeed() {
  const { medicalGroups, otcGroups, isLoading, decideGroup, invalidate } =
    useReviewFeed();
  const [ruleCandidate, setRuleCandidate] = useState<RuleCandidate | null>(
    null,
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [splitGroup, setSplitGroup] = useState<ReviewGroup | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const handleDecide = (
    group: ReviewGroup,
    isMedical: boolean,
    lane?: ReviewGroup["lane"],
  ) => {
    decideGroup.mutate(
      { merchantKey: group.merchant_key, isMedical, lane },
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
          // group's agreed-on keys. Not offered for the OTC lane: a rule
          // there would mean "never review this merchant again", which is
          // the wrong promise for a merchant whose basket contents vary.
          const key = groupRuleKey(group);
          if (key && lane !== "possible_otc") {
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

  if (medicalGroups.length === 0 && otcGroups.length === 0) {
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

  const splitTransaction = splitGroup?.single_transaction_id
    ? {
        id: splitGroup.single_transaction_id,
        amount: splitGroup.total_amount,
        vendor: splitGroup.display_name,
        description: splitGroup.display_name,
        transaction_date: splitGroup.latest_date,
      }
    : null;

  return (
    <>
      {medicalGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {medicalGroups.reduce((sum, g) => sum + g.txn_count, 0)}{" "}
              transaction
              {medicalGroups.reduce((sum, g) => sum + g.txn_count, 0) === 1
                ? ""
                : "s"}{" "}
              to review
            </CardTitle>
            <CardDescription>
              Grouped by merchant so one answer covers all of them. These look
              medical.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {medicalGroups.map((group) => (
              <GroupRow
                key={group.merchant_key}
                group={group}
                busy={decideGroup.isPending}
                onDecide={(isMedical) =>
                  handleDecide(group, isMedical, "medical")
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {otcGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Might contain over-the-counter items</CardTitle>
            <CardDescription>
              These merchants aren&rsquo;t medical on their own, but a basket
              here can still have a qualifying item mixed in — allergy medicine,
              contact lens solution, and the like.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {otcGroups.map((group) => (
              <OtcGroupRow
                key={group.merchant_key}
                group={group}
                busy={decideGroup.isPending}
                onDismiss={() => handleDecide(group, false, "possible_otc")}
                onSplit={() => setSplitGroup(group)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {decideGroup.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating&hellip;
        </p>
      )}

      <CreateRulePrompt
        candidate={ruleCandidate}
        onOpenChange={(open) => !open && setRuleCandidate(null)}
      />

      {splitTransaction && userId && (
        <ExpenseSplitDialog
          open={!!splitGroup}
          onOpenChange={(open) => !open && setSplitGroup(null)}
          transaction={splitTransaction}
          userId={userId}
          onSplit={invalidate}
        />
      )}
    </>
  );
}
