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
//
// 2026-09 (docs/TRANSACTION_REVIEW_SPEC.md, B1): the medical lane and the
// possible-OTC lane used to be two different components with two different
// capabilities — a medical-lane group could not be opened at all, and only
// the OTC lane could split a row. That asymmetry was the drift the spec was
// called to fix. One GroupRow now serves both lanes; the only remaining
// difference is that the OTC lane never offers a bulk "all of these are
// healthcare" button (see the comment on that button below — it's a
// deliberate rule-safety property, not a leftover).
//
// 2026-09 (B2): "medical" is retired from what the user reads. The word
// sounded like a clinical judgement the user isn't qualified to make;
// "healthcare" is the same idea in a word nobody thinks they can get wrong.
// Everywhere this file still says `isMedical`, `medicalGroups`, `is_medical`
// and so on, that is naming the underlying data (a database column, a prop)
// rather than copy a user reads — those stay as they are. Also: the negative
// answer is a dismissal, not a verdict, and says so — "Dismissed — we won't
// ask again" — with a real Undo for a few seconds, wherever this component
// still has the transaction id(s) on hand to reverse it. A bulk dismissal
// clicked on a COLLAPSED group has no such list client-side without a
// backend change this pass didn't make, so that one case gets the wording
// without the undo button — noted at the toast call site below.
//
// 2026-09 (C1): confirming a transaction as healthcare no longer forces
// SubstantiateDialog open. Spec D15/D16 — "offer, don't gate": a modal per
// confirmation was right for one transaction in isolation and wrong for a
// queue, where it happens dozens of times in a row and the receipt is
// almost never to hand anyway. The offer is now a toast with an action
// button; nothing opens or navigates until the user clicks it. A single
// decision's toast opens the dialog in place. A bulk decision's toast
// links to Substantiate instead — stacking N upload dialogs would be worse
// than the modal it replaces — filtered to exactly those expenses when the
// touched transaction ids are known (see GroupRow's `knownTxnIds`), and to
// the plain queue when they aren't (a bulk decide on a group nobody had
// expanded first).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { logError } from "@/utils/errorHandler";
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

/**
 * Spec D11: a decided row fades over ~200ms rather than vanishing the instant
 * its mutation resolves — snapping away shifts whatever was next under a
 * cursor that is still there, mid-click, working through the list. The
 * mechanism is deliberately simple: mark the target as "leaving" so its CSS
 * transition starts immediately, then hold the real mutation for exactly this
 * long before firing it. That guarantees the fade always plays in full — a
 * fast network response can't cut it short — without needing to reconcile a
 * locally-held row against query data that has already moved on.
 */
const FADE_MS = 200;

/** The shape ExpenseSplitDialog needs, built from a single-transaction group
 *  that has no expanded row of its own to read it from. */
function soloTransactionOf(group: ReviewGroup): ReviewGroupTransaction | null {
  if (!group.single_transaction_id) return null;
  return {
    id: group.single_transaction_id,
    transaction_date: group.latest_date,
    amount: group.total_amount,
    vendor: group.display_name,
    description: group.display_name,
    category: null,
    classification_explanation: group.explanation,
  };
}

function GroupRow({
  group,
  onDecideGroup,
  onSplitTransaction,
  onDecideTransaction,
  busy,
}: {
  group: ReviewGroup;
  /**
   * Bulk-decide the whole merchant. The OTC lane only ever calls this with
   * `false` — see the button below.
   *
   * `knownTxnIds`, when present, is exactly the set of transaction ids this
   * click is about to touch — known only when the group is a single row, or
   * is expanded with its list already loaded. It lets the caller offer a real
   * Undo on a dismissal; its absence (a bulk click on a collapsed group) is
   * why that one case can't.
   */
  onDecideGroup: (isMedical: boolean, knownTxnIds?: string[]) => void;
  onSplitTransaction: (txn: ReviewGroupTransaction) => void;
  /**
   * `lane` rides along so the caller can offer a lane-accurate Undo: the
   * decide RPCs always stamp `classification_reason = 'user'`, and 'user' is
   * not 'possible_otc', so an undo that only restores `needs_review` would
   * land an OTC-lane transaction back in the medical lane instead of the one
   * it actually came from.
   */
  onDecideTransaction: (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
    lane: ReviewGroup["lane"],
  ) => void;
  busy: boolean;
}) {
  const many = group.txn_count > 1;
  const isOtc = group.lane === "possible_otc";
  const [expanded, setExpanded] = useState(false);
  // Fades the whole card: used for a bulk decision on a multi-transaction
  // group, and for any decision on a single-transaction group, since there
  // the card IS the row — there's nothing separate underneath to reveal.
  const [leavingGroup, setLeavingGroup] = useState(false);
  // Fades one row inside the expanded list, independent of the card itself.
  const [leavingTxnIds, setLeavingTxnIds] = useState<Set<string>>(new Set());

  // Only fetches once opened, and only while there's a list to open: a group
  // that has just been whittled down to one row (a sibling was just decided)
  // renders that row at the header instead, the same as a group that only
  // ever had one — `many` gone false is what turns that switch, and the old
  // `expanded` state from before the last row left would otherwise still be
  // true, fetching and rendering a now-redundant list underneath it.
  const {
    data: transactions,
    isLoading: loadingTransactions,
    error: transactionsError,
  } = useReviewGroupTransactions(
    expanded && many ? group.merchant_key : null,
    group.lane,
  );
  // Lane is part of the id: the same merchant name can in principle produce a
  // 'medical' group and a 'possible_otc' group at once (some of its charges
  // matched, some didn't), and each needs its own DOM id.
  const listId = `review-group-${group.merchant_key}-${group.lane}`;
  const dateRange =
    group.earliest_date === group.latest_date
      ? formatFeedDate(group.latest_date, "MMM d, yyyy")
      : `${formatFeedDate(group.earliest_date, "MMM yyyy")} – ${formatFeedDate(
          group.latest_date,
          "MMM yyyy",
        )}`;

  const solo = !many ? soloTransactionOf(group) : null;
  // The exact ids a bulk click is about to touch, when known: a solo group's
  // one row, or an already-loaded expanded list's rows. Undefined when
  // neither holds — a bulk click on a collapsed multi-row group — which is
  // exactly when the caller can't offer a real Undo.
  const knownTxnIds = solo
    ? [solo.id]
    : many && transactions
      ? transactions.map((t) => t.id)
      : undefined;

  const fadeThenDecideGroup = (isMedical: boolean) => {
    setLeavingGroup(true);
    window.setTimeout(() => onDecideGroup(isMedical, knownTxnIds), FADE_MS);
  };

  const fadeThenDecideTransaction = (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
  ) => {
    setLeavingTxnIds((prev) => new Set(prev).add(txn.id));
    window.setTimeout(
      () => onDecideTransaction(txn, isMedical, group.lane),
      FADE_MS,
    );
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all duration-200",
        leavingGroup &&
          "pointer-events-none max-h-0 overflow-hidden p-0 opacity-0",
      )}
    >
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

          {isOtc && many && (
            <p className="mt-2 text-xs text-muted-foreground">
              These vary trip to trip, so there is one answer per trip — open
              the list to split any healthcare items out of a particular one.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
          {many ? (
            <>
              {/* The OTC lane never gets this button. A bulk "all of these
                  are healthcare" here would mean "every Costco trip is
                  healthcare" — the one dangerous rule this app can offer —
                  and it stays unreachable by never rendering the control
                  that would create it, rather than by a check somewhere
                  else. See docs/TRANSACTION_REVIEW_SPEC.md D17. */}
              {!isOtc && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingGroup}
                  onClick={() => fadeThenDecideGroup(true)}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  All healthcare
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || leavingGroup}
                onClick={() => fadeThenDecideGroup(false)}
              >
                <XCircle className="mr-1 h-4 w-4" />
                {isOtc ? "None had healthcare items" : "Not healthcare"}
              </Button>
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
            </>
          ) : (
            <>
              {!isOtc && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingGroup}
                  onClick={() => fadeThenDecideGroup(true)}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  Healthcare
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || leavingGroup}
                onClick={() => fadeThenDecideGroup(false)}
              >
                <XCircle className="mr-1 h-4 w-4" />
                {isOtc ? "No healthcare items here" : "Not healthcare"}
              </Button>
              {solo && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingGroup}
                  onClick={() => onSplitTransaction(solo)}
                >
                  <Split className="mr-1 h-4 w-4" />
                  {isOtc ? "Split out healthcare items" : "Split"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && many && (
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
              className={cn(
                "flex flex-col gap-2 rounded-md border bg-muted/30 p-3 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between",
                leavingTxnIds.has(txn.id) &&
                  "pointer-events-none max-h-0 overflow-hidden border-0 p-0 opacity-0",
              )}
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
                  all of it counted, none of it did, or only part did. */}
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingTxnIds.has(txn.id)}
                  onClick={() => fadeThenDecideTransaction(txn, true)}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  Healthcare
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || leavingTxnIds.has(txn.id)}
                  onClick={() => fadeThenDecideTransaction(txn, false)}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  Not healthcare
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingTxnIds.has(txn.id)}
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
  const navigate = useNavigate();
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
  // The expense a receipt-offer toast's action was clicked for, so the
  // dialog opens on exactly the one the user just confirmed.
  const [substantiateId, setSubstantiateId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /**
   * Undo a dismissal. Spec D9: "not healthcare" is a dismissal, not a
   * verdict — nothing was created, nothing to unwind but the flag itself, so
   * putting a transaction back is just re-opening the question. Mirrors the
   * "put it back in the queue" shape `returnToReviewQueue` already uses
   * elsewhere on this page (Transactions.tsx) — `reconciliation_status`
   * back to 'unlinked' alongside `needs_review`, not only the review flag,
   * since 'ignored' is exactly what the dismissal itself set.
   *
   * A confirmed-healthcare decision has no equivalent: it already created an
   * expense, so "undo" would mean deleting that expense too, which is a
   * heavier, riskier action than a toast button should trigger silently.
   * The spec only asks for undo on the easy direction, and that's this one.
   *
   * `lane` restores which queue it comes back to. Both decide RPCs always
   * stamp `classification_reason = 'user'` (that IS the record of "a human
   * decided this"), and a group's lane is derived from that same column
   * (`classification_reason = 'possible_otc'` vs. anything else) — so without
   * this, undoing a dismissal from the OTC lane would resurrect the
   * transaction in the medical lane instead of the one it actually left.
   * `classification_explanation`, by contrast, cannot be restored this way —
   * the original classifier sentence was overwritten and never captured
   * client-side — so the row comes back reading "You said this wasn't
   * healthcare" rather than its original reasoning. Landing in the right
   * queue is the part worth getting exactly right; the explanation sentence
   * is not load-bearing the same way.
   */
  const undoDismissals = async (
    transactionIds: string[],
    lane: ReviewGroup["lane"],
  ) => {
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          needs_review: true,
          reconciliation_status: "unlinked",
          ...(lane === "possible_otc"
            ? { classification_reason: "possible_otc" }
            : {}),
        })
        .in("id", transactionIds);
      if (error) throw error;
      invalidate();
    } catch (error) {
      logError("Undo dismissal failed", error);
      toast.error("Could not undo that — dismiss it again if it comes back");
    }
  };

  /** A dismissal toast, with Undo when the caller can name exactly what to
   *  put back — see the comment on GroupRow's `knownTxnIds` prop. */
  const dismissedToast = (
    count: number,
    lane: ReviewGroup["lane"],
    undoIds?: string[],
  ) => {
    const message =
      count === 1
        ? "Dismissed — we won't ask again"
        : `${count} dismissed — we won't ask again`;
    if (undoIds && undoIds.length === count) {
      toast.success(message, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => undoDismissals(undoIds, lane),
        },
      });
    } else {
      toast.success(message);
    }
  };

  /**
   * D15's half of the receipt offer: one transaction just became one
   * expense. The toast's action opens SubstantiateDialog right here, over
   * the feed — by the time a click through to another page landed, the row
   * the user was just looking at would already be gone.
   */
  const offerReceiptForOne = (invoiceId: string | null) => {
    if (!invoiceId) {
      // Confirmed, but we could not name the expense. Say where it went
      // rather than silently doing nothing visible.
      toast.success("Marked as healthcare — it's waiting under Expenses");
      return;
    }
    toast.success("Marked as healthcare", {
      duration: 8000,
      action: {
        label: "Add a receipt",
        onClick: () => setSubstantiateId(invoiceId),
      },
    });
  };

  /**
   * D16's half: a bulk decision's offer scales and points at Substantiate
   * instead of opening in place — stacking N upload dialogs over the feed
   * would be worse than the automatic modal this whole pass exists to
   * remove. `invoiceIds` filters that page to exactly these expenses when
   * it is exactly `count` long; shorter (or empty) means the ids behind this
   * decision were never known client-side — a bulk decide on a group nobody
   * expanded first — and the link goes to the plain queue rather than a
   * filtered view that would silently be missing rows.
   */
  const offerReceiptsForMany = (count: number, invoiceIds: string[]) => {
    const filtered = invoiceIds.length === count;
    toast.success(`${count} expenses need a receipt`, {
      duration: 8000,
      action: {
        label: "Add receipts",
        onClick: () =>
          navigate(
            filtered
              ? `/substantiate?ids=${invoiceIds.join(",")}`
              : "/substantiate",
          ),
      },
    });
  };

  /** The invoice ids a set of just-decided transactions became, for the
   *  bulk receipt offer above. Best-effort: a failed read means an empty
   *  list, which offerReceiptsForMany already treats as "unknown". */
  const lookupInvoiceIds = async (
    transactionIds: string[],
  ): Promise<string[]> => {
    const { data, error } = await supabase
      .from("transactions")
      .select("invoice_id")
      .in("id", transactionIds)
      .not("invoice_id", "is", null);
    if (error) {
      logError("Could not read back new expense ids", error);
      return [];
    }
    return (data ?? [])
      .map((r) => r.invoice_id as string | null)
      .filter((id): id is string => !!id);
  };

  /**
   * Decide one basket inside an opened group.
   */
  const handleDecideTransaction = (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
    lane: ReviewGroup["lane"],
  ) => {
    decideTransaction.mutate(
      { transactionId: txn.id, isMedical },
      {
        onSuccess: ({ expenseId }) => {
          if (!isMedical) {
            dismissedToast(1, lane, [txn.id]);
            return;
          }
          offerReceiptForOne(expenseId);
        },
        onError: () => toast.error("Could not update that transaction"),
      },
    );
  };

  const handleDecide = (
    group: ReviewGroup,
    isMedical: boolean,
    knownTxnIds?: string[],
  ) => {
    decideGroup.mutate(
      { merchantKey: group.merchant_key, isMedical, lane: group.lane },
      {
        onSuccess: async (count) => {
          if (!isMedical) {
            dismissedToast(count, group.lane, knownTxnIds);
          } else if (count === 1) {
            const invoiceId = knownTxnIds?.[0]
              ? (await lookupInvoiceIds([knownTxnIds[0]]))[0]
              : undefined;
            offerReceiptForOne(invoiceId ?? null);
          } else {
            const invoiceIds = knownTxnIds
              ? await lookupInvoiceIds(knownTxnIds)
              : [];
            offerReceiptsForMany(count, invoiceIds);
          }
          // Offer a rule so this merchant stops appearing. The prompt reads
          // the same fields a transaction would expose, so hand it the
          // group's agreed-on keys. Not offered for the OTC lane: a rule
          // there would mean "never review this merchant again", which is
          // the wrong promise for a merchant whose basket contents vary.
          const key = groupRuleKey(group);
          if (key && group.lane !== "possible_otc") {
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
              Everything that looked like healthcare has been sorted.
              Transactions that clearly aren&rsquo;t healthcare are filed
              automatically — you can find them under All transactions.
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

  const busy = decideGroup.isPending || decideTransaction.isPending;

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
              like healthcare.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {medicalGroups.map((group) => (
              <GroupRow
                key={group.merchant_key}
                group={group}
                busy={busy}
                onDecideGroup={(isMedical, knownTxnIds) =>
                  handleDecide(group, isMedical, knownTxnIds)
                }
                onSplitTransaction={setSplitTarget}
                onDecideTransaction={handleDecideTransaction}
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
              These merchants aren&rsquo;t healthcare on their own, but a basket
              here can still have a qualifying item mixed in — allergy medicine,
              contact lens solution, and the like.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {otcGroups.map((group) => (
              <GroupRow
                key={group.merchant_key}
                group={group}
                busy={busy}
                onDecideGroup={(isMedical, knownTxnIds) =>
                  handleDecide(group, isMedical, knownTxnIds)
                }
                onSplitTransaction={setSplitTarget}
                onDecideTransaction={handleDecideTransaction}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {busy && (
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
          // A split fires its own database write the instant it saves, so
          // unlike the two decide paths above there's no "before" moment left
          // to fade from — the dialog itself closing is the visual event.
          // Held for FADE_MS anyway so this doesn't refetch and pull the row
          // out from under the dialog's own closing animation.
          onSplit={() => window.setTimeout(invalidate, FADE_MS)}
        />
      )}

      {/* Opens only from the receipt-offer toast's action, never automatically
          (D15). When it does open, it's on the expense the confirmation just
          created, so the receipt and service details are captured while the
          user is still looking at the charge — rather than sending them to
          Expenses to find a row they have not seen before. Closing it costs
          nothing: the expense exists and is waiting there either way. */}
      <SubstantiateDialog
        expenseId={substantiateId}
        open={!!substantiateId}
        onOpenChange={(open) => !open && setSubstantiateId(null)}
      />
    </>
  );
}
