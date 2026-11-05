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
//
// The date is taken as soon as the typed text is a complete, valid date (V1
// launch plan, Batch 1). It used to be taken only on blur, so after the
// browser autofilled the box -- which fires no blur -- the Continue button
// next to it stayed greyed out under a perfectly good date, and the box read
// as broken. Parsing rules live in src/lib/dateInput.ts.

import * as React from "react";
import { format, startOfDay } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseCompleteDate, parseTypedDate } from "@/lib/dateInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DISPLAY_FORMAT = "MM/dd/yyyy";

const sameDate = (a: Date | undefined, b: Date | undefined) =>
  a === b || (!!a && !!b && a.getTime() === b.getTime());

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
    value ? format(value, DISPLAY_FORMAT) : "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  // The last date this box itself reported. A `value` equal to it is our own
  // keystroke coming back round, and must not rewrite the text: doing so
  // would reformat "3/4/2009" to "03/04/2009" under the user's cursor.
  const reported = React.useRef<Date | undefined>(value);

  const report = (d: Date | undefined) => {
    if (sameDate(d, reported.current)) return;
    reported.current = d;
    onChange(d);
  };

  // Keep the box in step when the date is changed from outside (a form
  // reset, a parent pre-filling it).
  React.useEffect(() => {
    if (sameDate(value, reported.current)) return;
    reported.current = value;
    setText(value ? format(value, DISPLAY_FORMAT) : "");
    setError(null);
  }, [value]);

  const outOfRange = (d: Date) =>
    (fromDate && d < startOfDay(fromDate)) ||
    (toDate && d > startOfDay(toDate));

  const rangeError = () =>
    outOfRangeMessage ??
    `Pick a date between ${fromDate ? format(fromDate, "MMM d, yyyy") : "—"} and ${
      toDate ? format(toDate, "MMM d, yyyy") : "—"
    }.`;

  // Every keystroke, and autofill. Takes the date the moment the text is a
  // whole one; anything short of that clears it, so the date the page holds
  // is always the one the box shows. A problem with an unfinished date waits
  // for blur -- telling someone "3/4/2" is wrong while they type it is noise.
  const handleTyping = (raw: string) => {
    setText(raw);
    const parsed = parseCompleteDate(raw);
    if (!parsed) {
      setError(null);
      report(undefined);
      return;
    }
    if (outOfRange(parsed)) {
      // Finished, and wrong: say so now. Continue stays disabled, and an
      // unexplained disabled button is the complaint this rewrite answers.
      setError(rangeError());
      report(undefined);
      return;
    }
    setError(null);
    report(parsed);
  };

  // Blur and Enter: the user is done, so accept every format (including
  // two-digit years), tidy the text, and explain anything still wrong.
  const commit = (raw: string) => {
    if (!raw.trim()) {
      setError(null);
      report(undefined);
      return;
    }
    const parsed = parseTypedDate(raw);
    if (!parsed) {
      setError("Try a date like 03/14/2009.");
      report(undefined);
      return;
    }
    if (outOfRange(parsed)) {
      setError(rangeError());
      report(undefined);
      return;
    }
    setError(null);
    setText(format(parsed, DISPLAY_FORMAT));
    report(parsed);
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
          onChange={(e) => handleTyping(e.target.value)}
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
                const picked = d ? startOfDay(d) : undefined;
                setText(picked ? format(picked, DISPLAY_FORMAT) : "");
                setError(null);
                report(picked);
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
