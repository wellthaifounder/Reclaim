import { format } from "date-fns";
import { parseDateOnly } from "@/lib/dates";

/**
 * transaction_date, earliest_date and latest_date are Postgres `date`
 * columns: calendar days with no time and no zone. `new Date("2026-09-02")`
 * parses that as UTC midnight, which is the evening of Sep 1 anywhere west of
 * Greenwich — see src/lib/dates.ts for the full story. This is that fix,
 * with a date-fns pattern string rather than Intl options, since the review
 * feed also needs "MMM yyyy" for a date range and formatDateOnly only takes
 * Intl.DateTimeFormatOptions.
 *
 * Shared between ReviewFeed.tsx and ReviewRowDetail.tsx so there is exactly
 * one place this parses a review-feed date, not two copies to keep in sync.
 */
export function formatFeedDate(value: string, pattern: string): string {
  const parsed = parseDateOnly(value);
  return parsed ? format(parsed, pattern) : value;
}
