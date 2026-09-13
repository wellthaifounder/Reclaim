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
  useReviewGroupTransactions,
  groupRuleKey,
  type ReviewGroup,
  type ReviewGroupTransaction,
} from "@/hooks/useReviewFeed";
import { cn } from "@/lib/utils";
import { parseDateOnly } from "@/lib/dates";
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
  ChevronDown,
} from "lucide-react";
import {
  CreateRulePrompt,
  type RuleCandidate,
} from "@/components/transactions/CreateRulePrompt";
import { ExpenseSplitDialog } from "@/components/transactions/ExpenseSplitDialog";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";

/**
 * transaction_date, earliest_date and latest_date are Postgres `date` columns:
 * calendar days with no time and no zone. `new Date("2026-09-02")` parses that
 * as UTC midnight, which is the evening of Sep 1 anywhere west of Greenwich —
 * so every date in this feed rendered a day early for users in the Americas.
 * src/lib/dates.ts exists for exactly this and the rest of the app already uses
 * it; the review feed had simply never been switched over.
 */
function formatFeedDate(value: string, pattern: string): string {
  const parsed = parseDateOnly(value);
  return parsed ? format(parsed, pattern) : value;
}

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
      ? formatFeedDate(group.latest_date, "MMM d, yyyy")
      : `${formatFeedDate(group.earliest_date, "MMM yyyy")} – ${formatFeedDate(
          group.latest_date,
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
 * expense on its own.
 *
 * Splitting needs one specific basket, so a multi-transaction group used to
 * offer only a bulk dismissal plus a sentence telling the user to go find a
 * transaction under All transactions. That was an instruction standing in for
 * a control: the one action this lane exists for was unreachable from the lane
 * itself. The group now opens to list its own transactions, each with its own
 * split button.
 */
function OtcGroupRow({
  group,
  onDismiss,
  onSplitTransaction,
  onDecideTransaction,
  busy,
}: {
  group: ReviewGroup;
  onDismiss: () => void;
  onSplitTransaction: (txn: ReviewGroupTransaction) => void;
  onDecideTransaction: (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
  ) => void;
  busy: boolean;
}) {
  const many = group.txn_count > 1;
  const [expanded, setExpanded] = useState(false);
  // Only fetches once opened.
  const {
    data: transactions,
    isLoading: loadingTransactions,
    error: transactionsError,
  } = useReviewGroupTransactions(
    expanded ? group.merchant_key : null,
    group.lane,
  );
  const listId = `otc-group-${group.merchant_key}`;
  const dateRange =
    group.earliest_date === group.latest_date
      ? formatFeedDate(group.latest_date, "MMM d, yyyy")
      : `${formatFeedDate(group.earliest_date, "MMM yyyy")} – ${formatFeedDate(
          group.latest_date,
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
              These vary trip to trip, so there is one answer per trip — open
              the list to split anything medical out of a particular one.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
          {many ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={listId}
            >
              <ChevronDown
                className={cn(
                  "mr-1 h-4 w-4 transition-transform",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
              {expanded ? "Hide" : `Show ${group.txn_count}`}
            </Button>
          ) : (
            group.single_transaction_id && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  onSplitTransaction({
                    id: group.single_transaction_id as string,
                    transaction_date: group.latest_date,
                    amount: group.total_amount,
                    vendor: group.display_name,
                    description: group.display_name,
                    category: null,
                    classification_explanation: group.explanation,
                  })
                }
              >
                <Split className="mr-1 h-4 w-4" />
                Split out medical items
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
            <XCircle className="mr-1 h-4 w-4" />
            {many ? "None had medical items" : "No medical items here"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div id={listId} className="mt-3 space-y-2 border-t pt-3">
          {loadingTransactions && (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          )}

          {transactionsError && (
            <p className="text-sm text-destructive">
              Could not load these transactions. Try again in a moment.
            </p>
          )}

          {transactions?.map((txn) => (
            <div
              key={txn.id}
              className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {txn.vendor || txn.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFeedDate(txn.transaction_date, "MMM d, yyyy")} &middot;{" "}
                  <Money value={txn.amount} />
                </p>
              </div>
              {/* Three answers, because a basket has three honest outcomes:
                  all of it counted, none of it did, or only part did. Until
                  now this row offered only the third, so a Walmart pharmacy
                  run had to be split into a single line against itself to be
                  claimed at all. */}
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onDecideTransaction(txn, true)}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  Medical
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onDecideTransaction(txn, false)}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  Not medical
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onSplitTransaction(txn)}
                >
                  <Split className="mr-1 h-4 w-4" />
                  Split
                </Button>
              </div>
            </div>
          ))}

          {transactions?.length === 0 && !loadingTransactions && (
            <p className="text-sm text-muted-foreground">
              These have already been decided.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewFeed() {
  const {
    medicalGroups,
    otcGroups,
    isLoading,
    decideGroup,
    decideTransaction,
    invalidate,
  } = useReviewFeed();
  const [ruleCandidate, setRuleCandidate] = useState<RuleCandidate | null>(
    null,
  );
  const [userId, setUserId] = useState<string | null>(null);
  // One specific basket to split, not a group: an opened group can name any of
  // its transactions, and a single-transaction group names its only one.
  const [splitTarget, setSplitTarget] = useState<ReviewGroupTransaction | null>(
    null,
  );
  // The expense a just-confirmed transaction became, held so the receipt step
  // can open on it straight away.
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /**
   * Decide one basket inside an opened group.
   *
   * Confirming it as medical creates the expense, and deciding it also removes
   * it from the review feed — so this is the last moment the transaction is in
   * front of the user. That is why the receipt step opens here rather than
   * leaving a trail to follow on another page: by the time they got there, the
   * row they were looking at would be gone.
   */
  const handleDecideTransaction = (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
  ) => {
    decideTransaction.mutate(
      { transactionId: txn.id, isMedical },
      {
        onSuccess: ({ expenseId }) => {
          if (!isMedical) {
            toast.success("Marked as not medical");
            return;
          }
          if (expenseId) {
            setSubstantiateId(expenseId);
            return;
          }
          // Confirmed, but we could not name the expense. Say where it went
          // rather than silently doing nothing visible.
          toast.success("Marked as medical — it's waiting under Expenses");
        },
        onError: () => toast.error("Could not update that transaction"),
      },
    );
  };

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
      <>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <PartyPopper className="h-8 w-8 text-primary" />
            <p className="font-medium">Nothing to review</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Everything that looked medical has been sorted. Transactions that
              clearly aren&rsquo;t medical are filed automatically — you can
              find them under All transactions.
            </p>
          </CardContent>
        </Card>
        {/* The rule prompt has to survive the queue emptying.
            Deciding the LAST group in the feed is what triggers this branch,
            and the prompt used to live only in the main return below — so the
            one decision most likely to be worth remembering was the one
            decision never offered a rule. */}
        <CreateRulePrompt
          candidate={ruleCandidate}
          onOpenChange={(open) => !open && setRuleCandidate(null)}
        />
      </>
    );
  }

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
                busy={decideGroup.isPending || decideTransaction.isPending}
                onDismiss={() => handleDecide(group, false, "possible_otc")}
                onSplitTransaction={setSplitTarget}
                onDecideTransaction={handleDecideTransaction}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {(decideGroup.isPending || decideTransaction.isPending) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating&hellip;
        </p>
      )}

      <CreateRulePrompt
        candidate={ruleCandidate}
        onOpenChange={(open) => !open && setRuleCandidate(null)}
      />

      {splitTarget && userId && (
        <ExpenseSplitDialog
          open={!!splitTarget}
          onOpenChange={(open) => !open && setSplitTarget(null)}
          transaction={{
            id: splitTarget.id,
            amount: splitTarget.amount,
            vendor: splitTarget.vendor,
            description: splitTarget.description ?? "",
            transaction_date: splitTarget.transaction_date,
            category: splitTarget.category,
          }}
          userId={userId}
          onSplit={invalidate}
        />
      )}

      {/* Opens on the expense the confirmation just created, so the receipt and
          the service details are captured while the user is still looking at
          the charge — rather than sending them to Expenses to find a row they
          have not seen before. Closing it costs nothing: the expense exists and
          is waiting there either way. */}
      <SubstantiateDialog
        expenseId={substantiateId}
        open={!!substantiateId}
        onOpenChange={(open) => !open && setSubstantiateId(null)}
      />
    </>
  );
}
