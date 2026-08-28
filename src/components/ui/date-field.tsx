// A date input you can type into, with a calendar as the second option rather
// than the only one.
//
// The calendar-in-a-popover pattern on its own is the slowest possible way to
// enter a date you already know: someone whose HSA opened in March 2009 has to
// page back 200 months, or hunt through dropdowns, to enter six characters
// they could have typed. Typing is the fast path; the calendar stays for
// browsing ("the second Tuesday of last month") and for touch.
//
// Parsing is deliberately forgiving about format and strict about the result:
// several common shapes are accepted, but a date outside [fromDate, toDate] is
// rejected and says why, because the alternative is silently storing a date
// that fails a gate much later with no explanation.

import * as React from "react";
import { format, isValid, parse, startOfDay } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Ordered most-specific first. Four-digit years are tried before two-digit
// ones so "3/4/2009" is never read as the year 20.
const ACCEPTED_FORMATS = [
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
  "MM/dd/yy",
  "M/d/yy",
];

/** Parse a typed date string, or return null. */
function parseTypedDate(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  for (const fmt of ACCEPTED_FORMATS) {
    const parsed = parse(raw, fmt, new Date());
    if (isValid(parsed)) {
      // date-fns `parse` accepts a partial match ("3/4/2009xyz" parses), so
      // re-format and compare to be sure the whole string was consumed.
      if (format(parsed, fmt).toLowerCase() === raw.toLowerCase()) {
        return startOfDay(parsed);
      }
    }
  }
  return null;
}

export interface DateFieldProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  /** Earliest selectable date, inclusive. Also bounds the year dropdown. */
  fromDate?: Date;
  /** Latest selectable date, inclusive. Also bounds the year dropdown. */
  toDate?: Date;
  placeholder?: string;
  /** Message shown when a typed date parses but falls outside the bounds. */
  outOfRangeMessage?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function DateField({
  value,
  onChange,
  fromDate,
  toDate,
  placeholder = "MM/DD/YYYY",
  outOfRangeMessage,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
}: DateFieldProps) {
  const [text, setText] = React.useState(
    value ? format(value, "MM/dd/yyyy") : "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  // Keep the box in step when the date is changed from outside (the calendar,
  // a form reset), without fighting the user mid-keystroke.
  React.useEffect(() => {
    if (value) setText(format(value, "MM/dd/yyyy"));
    else setText("");
    setError(null);
  }, [value]);

  const outOfRange = (d: Date) =>
    (fromDate && d < startOfDay(fromDate)) ||
    (toDate && d > startOfDay(toDate));

  const commit = (raw: string) => {
    if (!raw.trim()) {
      setError(null);
      onChange(undefined);
      return;
    }
    const parsed = parseTypedDate(raw);
    if (!parsed) {
      setError("Try a date like 03/14/2009.");
      return;
    }
    if (outOfRange(parsed)) {
      setError(
        outOfRangeMessage ??
          `Pick a date between ${fromDate ? format(fromDate, "MMM d, yyyy") : "—"} and ${
            toDate ? format(toDate, "MMM d, yyyy") : "—"
          }.`,
      );
      return;
    }
    setError(null);
    onChange(parsed);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label={ariaLabel ?? "Date"}
          aria-invalid={!!error}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            }
          }}
          className={cn(
            error && "border-destructive focus-visible:ring-destructive",
          )}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label="Open calendar"
              className="shrink-0"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value}
              // Open on the selected date, else on the latest allowed one, so
              // a bounded picker doesn't start on a month it cannot select.
              defaultMonth={value ?? toDate}
              onSelect={(d) => {
                onChange(d ? startOfDay(d) : undefined);
                setOpen(false);
              }}
              fromDate={fromDate}
              toDate={toDate}
              withMonthYearDropdowns
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
