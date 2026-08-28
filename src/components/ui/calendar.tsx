import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DayPicker,
  useDayPicker,
  useNavigation,
  type CaptionProps,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  /**
   * Replace the month name with month + year dropdowns.
   *
   * Worth turning on any time the target date could be years away — the HSA
   * establishment date is the standard case, where the arrows alone mean
   * clicking 200+ times to reach 2009. Pair it with `fromDate`/`toDate` (or
   * `fromYear`/`toYear`) so the year list has real bounds; without them the
   * range falls back to a century, which is a worse list than no list.
   */
  withMonthYearDropdowns?: boolean;
};

// Month names for the dropdown, in the picker's own locale rather than
// hardcoded English.
function useMonthOptions() {
  const { locale } = useDayPicker();
  return React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i,
        // date-fns types `month` as a 0-11 literal union; the loop index is a
        // plain number, so narrow it rather than widening the locale type.
        label:
          locale?.localize?.month(
            i as Parameters<typeof locale.localize.month>[0],
            {
              width: "abbreviated",
            },
          ) ??
          new Date(2000, i, 1).toLocaleString(undefined, { month: "short" }),
      })),
    [locale],
  );
}

const selectClasses = cn(
  "h-7 rounded-md border border-input bg-background px-2 text-sm font-medium",
  "text-foreground shadow-sm outline-none cursor-pointer",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
  "hover:bg-accent hover:text-accent-foreground transition-colors",
);

/**
 * Caption with real month and year controls.
 *
 * Native <select> on purpose rather than the Radix-based <Select>: this
 * renders inside a Popover, and a second popper layered in a first one is a
 * reliable source of focus-trap and click-outside bugs. Native also gives a
 * proper scrollable list for a 20+ year range, and a full-screen wheel on
 * mobile, which is exactly the interaction a year field wants.
 */
function MonthYearCaption({ displayMonth }: CaptionProps) {
  const { goToMonth, previousMonth, nextMonth } = useNavigation();
  const { fromDate, toDate } = useDayPicker();
  const months = useMonthOptions();

  const currentYear = displayMonth.getFullYear();
  const fromYear = fromDate?.getFullYear() ?? currentYear - 100;
  const toYear = toDate?.getFullYear() ?? currentYear + 10;

  // Newest first: every real use of this (an HSA opened, a bill paid) is far
  // likelier to be recent than to be at the start of the range.
  const years = React.useMemo(() => {
    const out: number[] = [];
    for (let y = toYear; y >= fromYear; y--) out.push(y);
    return out;
  }, [fromYear, toYear]);

  const changeMonth = (month: number) =>
    goToMonth(new Date(currentYear, month, 1));

  const changeYear = (year: number) => {
    // Clamp the day to 1 so switching to a month with fewer days can never
    // roll the view forward a month (31 Jan -> "31 Feb" -> 3 March).
    goToMonth(new Date(year, displayMonth.getMonth(), 1));
  };

  return (
    <div className="flex items-center justify-between gap-1 pt-1">
      <button
        type="button"
        aria-label="Previous month"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-20",
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-1">
        <select
          aria-label="Month"
          className={selectClasses}
          value={displayMonth.getMonth()}
          onChange={(e) => changeMonth(Number(e.target.value))}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Year"
          className={selectClasses}
          value={currentYear}
          onChange={(e) => changeYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        aria-label="Next month"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-20",
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  // Always render six week-rows. Months occupy five or six depending on where
  // the 1st falls, so without this the popover changes height as you page
  // through it and the buttons under it jump around under the cursor.
  fixedWeeks = true,
  withMonthYearDropdowns = false,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
        ...(withMonthYearDropdowns ? { Caption: MonthYearCaption } : {}),
        ...components,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
