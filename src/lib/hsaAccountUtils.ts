import { isAfter, isBefore, isSameDay, parseISO } from "date-fns";
import { formatDateOnly } from "./dates.ts";

export type HSAAccount = {
  id: string;
  user_id: string;
  account_name: string;
  opened_date: string;
  closed_date: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  // Edge case fields
  eligibility_start_date: string | null;
  qle_type: string | null;
  notes: string | null;
};

/**
 * Get the currently active HSA account
 * Returns the most recently opened active account
 */
export function getActiveHSAAccount(accounts: HSAAccount[]): HSAAccount | null {
  const activeAccounts = accounts.filter(
    (acc) => acc.is_active && !acc.closed_date,
  );

  if (activeAccounts.length === 0) return null;

  // Most recently opened first. opened_date is a plain "YYYY-MM-DD" calendar
  // day, so the strings already sort correctly; turning them into Date
  // objects is what read them as UTC midnight elsewhere in this file.
  return [...activeAccounts].sort((a, b) =>
    b.opened_date.localeCompare(a.opened_date),
  )[0];
}

/**
 * Get all HSA accounts that cover the given bill date
 * A bill is eligible if its date falls within the HSA account's active period
 */
export function getEligibleHSAAccounts(
  billDate: string | Date,
  accounts: HSAAccount[],
): HSAAccount[] {
  const date = typeof billDate === "string" ? parseISO(billDate) : billDate;

  return accounts.filter((account) => isDateInHSAPeriod(date, account));
}

/**
 * Check if a date falls within an HSA account's active period
 * The date must be on or after the opened_date and before or on the closed_date (if set)
 */
export function isDateInHSAPeriod(date: Date, account: HSAAccount): boolean {
  // Use eligibility_start_date if set (retroactive elections), otherwise fall back to opened_date
  const coverageStart = account.eligibility_start_date ?? account.opened_date;
  const openedDate = parseISO(coverageStart);

  // Date must be on or after the effective coverage start
  const isAfterOrSameAsOpened =
    isAfter(date, openedDate) || isSameDay(date, openedDate);

  if (!isAfterOrSameAsOpened) return false;

  // If no closed date, account is still open
  if (!account.closed_date) return true;

  const closedDate = parseISO(account.closed_date);

  // Date must be before or on closed date
  return isBefore(date, closedDate) || isSameDay(date, closedDate);
}

/**
 * Format HSA account date range for display.
 *
 * Through formatDateOnly, so the day shown is the day stored. This used
 * `new Date("2022-03-15")`, which is UTC midnight -- the evening of March 14
 * in every US time zone -- so an account opened on the 15th was listed as
 * opened on the 14th (V1 launch plan, Batch 1).
 */
export function formatHSAAccountDateRange(account: HSAAccount): string {
  const openedDate = formatDateOnly(account.opened_date);

  if (!account.closed_date) {
    return `${openedDate} - Present`;
  }

  const closedDate = formatDateOnly(account.closed_date);
  return `${openedDate} - ${closedDate}`;
}

/**
 * Validate that closed date is after opened date
 */
export function validateHSAAccountDates(
  openedDate: string,
  closedDate: string | null,
): string | null {
  if (!closedDate) return null;

  const opened = parseISO(openedDate);
  const closed = parseISO(closedDate);

  if (isBefore(closed, opened) || isSameDay(closed, opened)) {
    return "Closed date must be after opened date";
  }

  return null;
}
