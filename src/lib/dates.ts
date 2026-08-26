/**
 * Formatting for date-only values.
 *
 * Postgres `date` columns arrive as "2026-07-07" — a calendar day, with no
 * time and no zone. `new Date("2026-07-07")` does not treat it that way: the
 * ISO date-only form is defined to parse as UTC midnight, which is the
 * *previous* evening anywhere west of Greenwich. So
 * `new Date("2026-07-07").toLocaleDateString()` renders "7/6/2026" for every
 * user in the Americas.
 *
 * That is a real problem in this app rather than a cosmetic one. Date of
 * service decides the tax year an expense belongs to, and the HSA
 * establishment date is a hard cliff where one day early is never eligible.
 * A date that displays a day earlier than it was stored makes the app look
 * wrong at exactly the moment a user is checking our arithmetic against their
 * own paperwork.
 *
 * These helpers split the string and build a local date, so the day shown is
 * the day stored. Use them for `date`, `service_date`, `service_date_end` and
 * any other `date` column.
 *
 * Do NOT use them for timestamps (`created_at`, `uploaded_at`, and anything
 * else `timestamptz`). Those name a real instant, and converting them to the
 * viewer's zone is correct — `new Date(value)` is right there.
 */

/** Parse a "YYYY-MM-DD" string as local midnight. Returns null if unparseable. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/**
 * Format a "YYYY-MM-DD" string for display, in the day it was stored.
 * Falls back to the raw string if it is not a date we recognise, so a bad
 * value is visible rather than silently rendered as "Invalid Date".
 */
export function formatDateOnly(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "—";
  const parsed = parseDateOnly(value);
  if (!parsed) return value;
  return parsed.toLocaleDateString(undefined, options);
}
