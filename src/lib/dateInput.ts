// Parsing for the typed date box (src/components/ui/date-field.tsx).
//
// Kept out of the component so `npm test` can run it under plain Node: the
// rules for when a half-typed string counts as a date are where this box has
// gone wrong before, and they are easy to break without noticing.

import { format, isValid, parse, startOfDay } from "date-fns";

// Ordered most-specific first. Four-digit years are tried before two-digit
// ones so "3/4/2009" is never read as the year 20.
const FOUR_DIGIT_YEAR_FORMATS = [
  "MM/dd/yyyy",
  "M/d/yyyy",
  "MM-dd-yyyy",
  "M-d-yyyy",
  "yyyy-MM-dd",
  "yyyy/MM/dd",
  "MMMM d, yyyy",
  "MMMM d yyyy",
  "MMM d, yyyy",
  "MMM d yyyy",
  "MMddyyyy",
];

// Only accepted once the user has finished typing (blur or Enter). While they
// are still typing, "3/4/20" is the first six keystrokes of "3/4/2009" at
// least as often as it is a finished "3/4/2020", so taking it early would put
// a date in the box the user never meant.
const TWO_DIGIT_YEAR_FORMATS = ["MM/dd/yy", "M/d/yy"];

function parseWith(raw: string, formats: string[]): Date | null {
  for (const fmt of formats) {
    const parsed = parse(raw, fmt, new Date());
    if (isValid(parsed)) {
      // date-fns `parse` accepts a partial match ("3/4/2009xyz" parses), so
      // re-format and compare to be sure the whole string was consumed. This
      // also rejects "2009-03-1", which is a day short of finished.
      if (format(parsed, fmt).toLowerCase() === raw.toLowerCase()) {
        return startOfDay(parsed);
      }
    }
  }
  return null;
}

/**
 * The typed text as a date, if it is already a complete, unambiguous one.
 *
 * Used on every keystroke, so the box takes the date the moment it is whole --
 * including when the browser autofills it, which fires no blur. Before this
 * the date only landed on blur, and after autofill the Continue button beside
 * the box stayed greyed out with a valid date showing (V1 launch plan, Batch 1).
 */
export function parseCompleteDate(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  return parseWith(raw, FOUR_DIGIT_YEAR_FORMATS);
}

/**
 * The typed text as a date, accepting every shape the box allows -- for when
 * the user has finished (blur, Enter). Returns null if it is not a date.
 */
export function parseTypedDate(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  return (
    parseWith(raw, FOUR_DIGIT_YEAR_FORMATS) ??
    parseWith(raw, TWO_DIGIT_YEAR_FORMATS)
  );
}
