// L1 (docs/V1_LAUNCH_PLAN.md): every new bank connection asks Plaid for the
// most history it allows. Plaid fixes the amount when the bank is first
// connected and it cannot be raised afterwards — an existing connection has to
// be removed and connected again to get more.
//
// 730 is Plaid's maximum for `transactions.days_requested`. How much of it a
// bank actually returns varies by institution, which is why user-facing copy
// says "up to two years, depending on your bank".
//
// The same figure sizes the transfer-detection sweep, so the history Plaid
// returns and the window we de-duplicate card payments over cannot disagree.
export const PLAID_HISTORY_DAYS = 730;
