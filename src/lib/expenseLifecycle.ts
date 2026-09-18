/**
 * The lifecycle states that mean "step two is not done yet" — the definition
 * of the Substantiate tab's queue.
 *
 * `captured` joined them on 2026-09-06, when confirming a transaction as
 * medical became the thing that creates its expense. A brand-new expense has
 * eligibility 'unknown' and documentation 'none', which the lifecycle trigger
 * maps to `captured` — no document, no eligibility decision, which is the
 * definition of needing step two.
 *
 * It was excluded before for a reason that no longer holds: expenses used to
 * be created by the sync without anyone approving them, so `captured` was a
 * pile of the app's own guesses and would have buried the real queue. An
 * expense now exists only because the user approved it, so every one of them
 * belongs here. Leaving it out was what made six confirmed expenses worth
 * $2,642.13 land in a queue that said "you're all caught up".
 */
export const SUBSTANTIATE_STATES = [
  "captured",
  "needs_receipt",
  "pending_review",
] as const;

export type QueueLifecycle = (typeof SUBSTANTIATE_STATES)[number];
