import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

/**
 * A formatted money amount.
 *
 * Two jobs, both of which were being done inconsistently or not at all:
 *
 * 1. **Separators.** Amounts were built by hand as `` `$${n.toFixed(2)}` ``,
 *    which produces `$15109.32`. Only the largest -- and therefore most
 *    important -- figures were affected, because smaller ones have no
 *    thousands place to separate.
 *
 * 2. **Alignment.** `tabular-nums` makes every digit the same width, so
 *    amounts stacked in a column line up on the decimal point instead of
 *    drifting. The app already used the class ad hoc in 17 places across 6
 *    files, including one that had the class but still called `.toFixed(2)`
 *    -- neatly aligned, still missing its comma.
 *
 * Prefer this over calling `formatCurrency` inline anywhere the amount is
 * rendered into the DOM. Reach for the bare function only where the result
 * goes somewhere that cannot take a className: a document, a toast, an
 * `aria-label`, a generated string.
 */
interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Null/undefined/non-finite renders as an em dash, never as $0.00. */
  value: number | null | undefined;
  currency?: string;
  /** Drop the cents. For headline figures where they are noise. */
  whole?: boolean;
}

export function Money({
  value,
  currency = "USD",
  whole = false,
  className,
  ...props
}: MoneyProps) {
  const text = formatCurrency(
    value,
    currency,
    whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : undefined,
  );

  return (
    <span className={cn("tabular-nums", className)} {...props}>
      {text}
    </span>
  );
}
