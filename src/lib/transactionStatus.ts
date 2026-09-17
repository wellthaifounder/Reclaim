/**
 * Spec D42–D44: the five states a charge can be in, and the one function that
 * decides which one it is in.
 *
 * The states are a 2×2 of *who decided* against *what they decided*, plus
 * transfers off to the side:
 *
 *                    | said healthcare | said not healthcare
 *   ------------------+-----------------+---------------------
 *   the user (or a    | Healthcare      | Not healthcare
 *   rule they wrote)  |                 |
 *   the engine alone  | — (never; D36)  | Filed automatically
 *   nobody yet        | Needs review    | Needs review
 *
 * The engine-said-healthcare cell is empty by construction: every tier of the
 * classifier that concludes "this IS healthcare" also sets needs_review, so it
 * is asking rather than deciding. That asymmetry is D36's whole premise.
 *
 * This replaces D27's five named views, which mixed this question ("what did
 * we decide about this charge") with a question from a different step of the
 * spine ("what is missing downstream" — the old "Needs a receipt" view, now
 * D46 and living on Substantiate, whose queue is keyed on the same column).
 *
 * `assign` returns exactly one state per row, and `matches` is written in
 * terms of it, so the counts beside the filter can never disagree with what
 * the filter then shows.
 */

export const TRANSACTION_STATUSES = [
  "everything",
  "healthcare",
  "not_healthcare",
  "needs_review",
  "auto_filed",
  "transfers",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Every state except the catch-all, i.e. what `assign` can return. */
export type AssignedStatus = Exclude<TransactionStatus, "everything">;

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  everything: "Everything",
  healthcare: "Healthcare",
  // D42 retires "Dismissed". It always meant "not healthcare", and the word
  // described the click rather than the answer.
  not_healthcare: "Not healthcare",
  needs_review: "Needs review",
  auto_filed: "Filed automatically",
  transfers: "Transfers",
};

export const TRANSACTION_STATUS_EMPTY_COPY: Record<TransactionStatus, string> =
  {
    everything: "Nothing here yet",
    healthcare: "Nothing confirmed as healthcare yet",
    not_healthcare: "You haven't ruled anything out yet",
    needs_review: "Nothing waiting on you",
    auto_filed: "We haven't filed anything on our own",
    transfers: "No transfers between your own accounts",
  };

/** The columns a state depends on. Deliberately a structural type: the page
 *  passes whole rows, but nothing here should need more than these. */
export interface TransactionStatusFields {
  is_medical: boolean | null;
  needs_review: boolean | null;
  is_transfer: boolean | null;
  classification_reason: string | null;
}

/** A decision is the user's when they made it directly, or when a rule they
 *  wrote made it for them — a rule is a standing instruction, not the engine
 *  guessing. `bulk_review_merchant`, `decide_transactions` and
 *  `apply_categorization_rule` are the three writers that stamp these. */
const USER_REASONS: ReadonlySet<string> = new Set(["user", "rule"]);

export function assignTransactionStatus(
  t: TransactionStatusFields,
): AssignedStatus {
  // Transfers first: moving money between your own accounts was never a
  // healthcare question, so it is not an unanswered one either.
  if (t.is_transfer === true) return "transfers";

  // Then the queue. D43: a charge the engine suggested but nobody approved is
  // waiting on the user, not filed under Healthcare — checked before
  // is_medical precisely so the engine's suggestion cannot borrow the user's
  // authority.
  if (t.needs_review === true) return "needs_review";

  if (t.is_medical === true) return "healthcare";

  const reason = t.classification_reason ?? "";
  if (USER_REASONS.has(reason)) return "not_healthcare";

  // Left over: not healthcare, nobody asked, and the engine is the only one
  // who ever looked. D44 gives this pile a permanent door with a count on it.
  return "auto_filed";
}

export function matchesTransactionStatus(
  t: TransactionStatusFields,
  status: TransactionStatus,
): boolean {
  if (status === "everything") return true;
  return assignTransactionStatus(t) === status;
}

/** Counts for the filter's own labels. "Everything" counts every row, so the
 *  parts do not sum to it only in the sense that every row is in exactly one
 *  of the other five. */
export function countTransactionStatuses(
  rows: readonly TransactionStatusFields[],
): Record<TransactionStatus, number> {
  const counts: Record<TransactionStatus, number> = {
    everything: rows.length,
    healthcare: 0,
    not_healthcare: 0,
    needs_review: 0,
    auto_filed: 0,
    transfers: 0,
  };
  for (const row of rows) counts[assignTransactionStatus(row)] += 1;
  return counts;
}

export function isTransactionStatus(v: string): v is TransactionStatus {
  return (TRANSACTION_STATUSES as readonly string[]).includes(v);
}
