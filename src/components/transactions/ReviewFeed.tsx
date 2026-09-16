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
//
// 2026-09 (C2): the "remember this?" rule prompt used to fire only after a
// bulk decide, and never in the OTC lane — both narrower than spec D17-D19,
// which asks for it after ANY answer (a bulk click, a solo merchant, or one
// row inside an expanded group) in EITHER lane, gated only on the merchant
// being fully decided with no conflicting history (see `maybeOfferRule`
// below). D20 rewrote the prompt's copy to lead with the forward promise
// instead of the past-tense fact. D21 turned it from a blocking modal into a
// non-modal panel (CreateRulePrompt.tsx) so it can sit on screen at the same
// time as the receipt-offer toast above, instead of one silently pre-empting
// the other.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  useReviewFeed,
  useReviewGroupTransactions,
  useAutoFiledCount,
  groupRuleKey,
  type ReviewGroup,
  type ReviewGroupTransaction,
} from "@/hooks/useReviewFeed";
import { cn } from "@/lib/utils";
import { formatFeedDate } from "@/components/transactions/reviewFeedDates";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  PartyPopper,
  Loader2,
  Store,
  Split,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";
import {
  CreateRulePrompt,
  type RuleCandidate,
} from "@/components/transactions/CreateRulePrompt";
import { ExpenseSplitDialog } from "@/components/transactions/ExpenseSplitDialog";
import { SubstantiateDialog } from "@/components/expense/SubstantiateDialog";
import { SwipeableRow } from "@/components/transactions/SwipeableRow";
import { ReviewRowDetail } from "@/components/transactions/ReviewRowDetail";
import { useSwipeCoachMark } from "@/hooks/useSwipeCoachMark";
import { FF } from "@/lib/featureFlags";

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
  showCoachMark,
  onCoachMarkDone,
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
   * The whole group rides along, not just its lane: the caller needs it for
   * a lane-accurate Undo (the decide RPCs always stamp
   * `classification_reason = 'user'`, so an undo that only restores
   * `needs_review` would land an OTC-lane transaction back in the medical
   * lane) and, per spec D17-D19, to check whether this merchant just became
   * fully decided and so has a rule to offer.
   */
  onDecideTransaction: (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
    group: ReviewGroup,
  ) => void;
  busy: boolean;
  /** Spec D35: true for exactly one GroupRow per queue visit — the one
   *  holding whichever row claims the coach mark. See ReviewFeed's
   *  coachMarkTargetKey. */
  showCoachMark: boolean;
  onCoachMarkDone: () => void;
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
  // Spec D35's "tap for detail": at most one detail panel open at a time,
  // between the solo card and any row inside an expanded list.
  const [soloDetailOpen, setSoloDetailOpen] = useState(false);
  const [detailOpenTxnId, setDetailOpenTxnId] = useState<string | null>(null);

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
      () => onDecideTransaction(txn, isMedical, group),
      FADE_MS,
    );
  };

  const headerRow = (
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
            These vary trip to trip — mark a trip healthcare or not, or open it
            to split the healthcare items out of a particular one.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
        {many ? (
          <>
            {/* No special-casing by lane: a basket can be entirely
                  healthcare items just as easily as entirely groceries, so
                  this button is offered here exactly like it is in the
                  medical lane -- see docs/TRANSACTION_REVIEW_SPEC.md D17
                  (superseded 2026-09-16; that note assumed the wrong thing
                  about the OTC lane and is kept in the doc only as history). */}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || leavingGroup}
              onClick={() => fadeThenDecideGroup(true)}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              All healthcare
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || leavingGroup}
              onClick={() => fadeThenDecideGroup(false)}
            >
              <XCircle className="mr-1 h-4 w-4" />
              {isOtc ? "None had healthcare items" : "Not healthcare"}
            </Button>
            {/* Spec D34: with "All healthcare" and "Not healthcare" both
                  spelled out in full, a third full-width text button here
                  is what wrapped this row onto three lines at 390px. Unlike
                  Split on the rows below, this button IS the primary way
                  into the group -- hiding it in an overflow menu would bury
                  the one action most people take first. Shrinking it to an
                  icon below sm keeps it a single, always-visible tap instead. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={listId}
              aria-label={
                expanded ? "Hide" : `Show ${group.txn_count} transactions`
              }
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform sm:mr-1",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
              <span className="hidden sm:inline" aria-hidden="true">
                {expanded ? "Hide" : `Show ${group.txn_count}`}
              </span>
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || leavingGroup}
              onClick={() => fadeThenDecideGroup(true)}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Healthcare
            </Button>
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
              <>
                {/* Spec D34: at narrow widths a row shows two buttons
                      (Healthcare / Not healthcare) plus an overflow menu,
                      not three buttons wrapping onto two lines -- applies
                      identically in both lanes now that Healthcare is
                      offered in both. */}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || leavingGroup}
                  onClick={() => onSplitTransaction(solo)}
                  className="hidden sm:inline-flex"
                >
                  <Split className="mr-1 h-4 w-4" />
                  Split
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || leavingGroup}
                      className="h-8 w-8 p-0 text-muted-foreground sm:hidden"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">More actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onSplitTransaction(solo)}>
                      <Split className="mr-2 h-4 w-4" />
                      Split
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all duration-200",
        leavingGroup &&
          "pointer-events-none max-h-0 overflow-hidden p-0 opacity-0",
      )}
    >
      {/* Spec D35: swipe never applies to a collapsed multi-transaction
          group -- one careless gesture could bulk-decide dozens of
          transactions at once. A solo group's card IS one transaction, so
          it gets the gesture; an unopened "many" group doesn't. */}
      {many ? (
        headerRow
      ) : (
        <SwipeableRow
          enabled={FF.SWIPE_TO_TRIAGE}
          disabled={busy || leavingGroup}
          onConfirm={() => fadeThenDecideGroup(true)}
          onDismiss={() => fadeThenDecideGroup(false)}
          onTap={() => setSoloDetailOpen((v) => !v)}
          showCoachMark={showCoachMark}
          onCoachMarkDone={onCoachMarkDone}
        >
          {headerRow}
        </SwipeableRow>
      )}

      {!many && solo && soloDetailOpen && (
        <ReviewRowDetail
          vendor={solo.vendor || solo.description || group.display_name}
          date={solo.transaction_date}
          amount={solo.amount}
          category={solo.category}
          explanation={solo.classification_explanation}
          onConfirm={() => fadeThenDecideGroup(true)}
          onDismiss={() => fadeThenDecideGroup(false)}
          onSplit={() => onSplitTransaction(solo)}
          onClose={() => setSoloDetailOpen(false)}
          busy={busy || leavingGroup}
        />
      )}

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

          {transactions?.map((txn) => {
            const rowLeaving = leavingTxnIds.has(txn.id);
            const rowContent = (
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-md border bg-muted/30 p-3 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between",
                  rowLeaving &&
                    "pointer-events-none max-h-0 overflow-hidden border-0 p-0 opacity-0",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {txn.vendor || txn.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFeedDate(txn.transaction_date, "MMM d, yyyy")}{" "}
                    &middot; <Money value={txn.amount} />
                  </p>
                </div>
                {/* Three answers, because a basket has three honest outcomes:
                    all of it counted, none of it did, or only part did. */}
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || rowLeaving}
                    onClick={() => fadeThenDecideTransaction(txn, true)}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Healthcare
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || rowLeaving}
                    onClick={() => fadeThenDecideTransaction(txn, false)}
                  >
                    <XCircle className="mr-1 h-4 w-4" />
                    Not healthcare
                  </Button>
                  {/* Spec D34: Healthcare / Not healthcare stay visible at
                      every width; Split -- the least-used of the three
                      answers -- moves behind an overflow menu below sm
                      instead of wrapping this row onto a second line. */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || rowLeaving}
                    onClick={() => onSplitTransaction(txn)}
                    className="hidden sm:inline-flex"
                  >
                    <Split className="mr-1 h-4 w-4" />
                    Split
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || rowLeaving}
                        className="h-8 w-8 p-0 text-muted-foreground sm:hidden"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">More actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onSplitTransaction(txn)}>
                        <Split className="mr-2 h-4 w-4" />
                        Split
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
            return (
              <div key={txn.id}>
                <SwipeableRow
                  enabled={FF.SWIPE_TO_TRIAGE}
                  disabled={busy || rowLeaving}
                  onConfirm={() => fadeThenDecideTransaction(txn, true)}
                  onDismiss={() => fadeThenDecideTransaction(txn, false)}
                  onTap={() =>
                    setDetailOpenTxnId((cur) =>
                      cur === txn.id ? null : txn.id,
                    )
                  }
                >
                  {rowContent}
                </SwipeableRow>
                {detailOpenTxnId === txn.id && (
                  <ReviewRowDetail
                    vendor={txn.vendor || txn.description || "Unknown vendor"}
                    date={txn.transaction_date}
                    amount={txn.amount}
                    category={txn.category}
                    explanation={txn.classification_explanation}
                    onConfirm={() => fadeThenDecideTransaction(txn, true)}
                    onDismiss={() => fadeThenDecideTransaction(txn, false)}
                    onSplit={() => onSplitTransaction(txn)}
                    onClose={() => setDetailOpenTxnId(null)}
                    busy={busy || rowLeaving}
                  />
                )}
              </div>
            );
          })}

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
  // Spec D28. Queried unconditionally rather than only once the queue is
  // empty -- the empty state is a conditional early return below, and hooks
  // can't follow it there.
  const { data: autoFiledCount = 0 } = useAutoFiledCount();
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

  // Spec D35: the coach mark claims exactly one row per queue visit -- the
  // first solo (single-transaction) group, medical lane first. Lane is part
  // of the key for the same reason listId includes it: the same merchant
  // name can produce a medical group and an OTC group at once. If the queue
  // happens to hold no solo groups on load, no row claims it -- accepted
  // rather than also reaching into collapsed groups' hidden per-transaction
  // rows to find one, which would need those lists fetched just to place a
  // coach mark.
  const [coachMarkSeen, markCoachMarkSeen] = useSwipeCoachMark();
  const coachMarkTargetKey = useMemo(() => {
    const soloGroup = [...medicalGroups, ...otcGroups].find(
      (g) => g.txn_count === 1,
    );
    return soloGroup ? `${soloGroup.merchant_key}-${soloGroup.lane}` : null;
  }, [medicalGroups, otcGroups]);

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
   * D17-D19: the rule offer follows every answer — a bulk click, a solo
   * group, or one row inside an expanded list — not only a bulk one, and not
   * only in the medical lane. D17's own rationale is explicit that the OTC
   * lane is not a special case: the one dangerous rule ("every Costco trip
   * is healthcare") is already unreachable because the OTC lane never
   * renders the bulk "all of these are healthcare" button in the first
   * place (see that button's own comment below) — nothing here needs to
   * re-guard against it.
   *
   * D18 is the real constraint: a rule is only offered once the merchant is
   * *fully* decided, and only if every one of its decided transactions
   * agrees. A bulk click decides everything pending for that merchant in one
   * shot, so it trivially agrees with itself — but it can still collide with
   * an older, different verdict on the same merchant from a previous visit,
   * and a per-row click inside an expanded group almost always leaves
   * siblings still pending. Both cases go through this one check rather than
   * two separate ones, so "fully decided and consistent" means the same
   * thing everywhere it's asked.
   *
   * Split rows are excluded: a split answers "part of this basket", not
   * "this merchant", and folding it into the count would make a merchant
   * that still has an honest mixed history read as unanimous.
   */
  const maybeOfferRule = async (group: ReviewGroup, isMedical: boolean) => {
    const key = groupRuleKey(group);
    if (!key) return;
    const { data, error } = await supabase
      .from("transactions")
      .select("is_medical, needs_review")
      .eq("merchant_normalized", group.merchant_key)
      .is("split_parent_id", null);
    if (error) {
      logError("Could not check whether this merchant is fully decided", error);
      return;
    }
    const rows = data ?? [];
    if (rows.some((r) => r.needs_review)) return;
    const decided = rows.filter((r) => !r.needs_review);
    if (!decided.every((r) => r.is_medical === isMedical)) return;
    setRuleCandidate({
      merchant_entity_id: group.merchant_entity_id,
      merchant_category_code: group.mcc,
      vendor: group.display_name,
      description: group.display_name,
      isMedical,
    });
  };

  /**
   * Decide one basket inside an opened group.
   */
  const handleDecideTransaction = (
    txn: ReviewGroupTransaction,
    isMedical: boolean,
    group: ReviewGroup,
  ) => {
    decideTransaction.mutate(
      { transactionId: txn.id, isMedical },
      {
        onSuccess: async ({ expenseId }) => {
          if (!isMedical) {
            dismissedToast(1, group.lane, [txn.id]);
          } else {
            offerReceiptForOne(expenseId);
          }
          await maybeOfferRule(group, isMedical);
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
          await maybeOfferRule(group, isMedical);
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
            </p>
            {/* Spec D28: a narrow classifier is correct to never ask about
                Netflix, but a miss the same way -- flagging 0 of a real
                account's 208 charges, once -- is invisible forever if nothing
                ever points at the auto-filed pile. One sentence, only when
                there's something to see, not a recurring nag. */}
            {autoFiledCount > 0 && (
              <p className="max-w-sm text-sm text-muted-foreground">
                We also filed {autoFiledCount} charge
                {autoFiledCount === 1 ? "" : "s"} as not healthcare.{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    navigate("/transactions?tab=all&view=auto_filed")
                  }
                >
                  Worth a look?
                </button>
              </p>
            )}
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
                showCoachMark={
                  !coachMarkSeen &&
                  `${group.merchant_key}-${group.lane}` === coachMarkTargetKey
                }
                onCoachMarkDone={markCoachMarkSeen}
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
                showCoachMark={
                  !coachMarkSeen &&
                  `${group.merchant_key}-${group.lane}` === coachMarkTargetKey
                }
                onCoachMarkDone={markCoachMarkSeen}
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
