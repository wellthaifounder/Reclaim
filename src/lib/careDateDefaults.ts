// The date-of-care default and its one dangerous case (SUBSTANTIATE_SPEC S18, S19).
//
// A blank date of care is already treated as the payment date everywhere the
// rules run (`invoices.effective_service_date`). The dialog now SHOWS that
// assumption as the starting value instead of hiding it.
//
// The pre-fill is wrong in exactly one situation that matters: care received
// before the HSA opened, paid for just after. The IRS never allows that, and a
// pre-filled date would make it look eligible. So while the date is still the
// pre-fill, and the payment landed within a short window after the opening,
// the person is asked to check the date on the bill.

import { parseDateOnly } from "@/lib/dates";

/** How long after the HSA opened a payment can still be for earlier care. */
export const EARLY_PAYMENT_WINDOW_DAYS = 90;

/**
 * True when `paidDate` is on or after `openedDate` but no more than
 * EARLY_PAYMENT_WINDOW_DAYS after it. A payment before the opening is not this
 * case: the timing gate already refuses it outright.
 */
export function paidShortlyAfterHsaOpened(
  paidDate: string | null | undefined,
  openedDate: string | null | undefined,
): boolean {
  const paid = parseDateOnly(paidDate);
  const opened = parseDateOnly(openedDate);
  if (!paid || !opened) return false;

  const cutoff = new Date(opened);
  cutoff.setDate(cutoff.getDate() + EARLY_PAYMENT_WINDOW_DAYS);
  return paid >= opened && paid <= cutoff;
}
