import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * What we show instead of an amount when there is no amount to show.
 *
 * Deliberately not "$0.00". A null amount means *unknown* -- a nullable column
 * that was never filled in, a total over an empty set -- and rendering that as
 * zero states a figure we do not have. On a product where the numbers are
 * someone's medical spending and their tax position, a confidently wrong $0.00
 * is worse than a visible blank.
 */
export const MONEY_PLACEHOLDER = "—";

/**
 * The one money formatter. Everything user-facing goes through here.
 *
 * The app previously carried seven of these, five producing identical output,
 * and the sites that used none of them built strings by hand with
 * `` `$${n.toFixed(2)}` `` -- which is why five-figure amounts rendered as
 * `$15109.32`, with no thousands separator. `Intl.NumberFormat` places the
 * separators and the symbol correctly.
 *
 * Accepts null/undefined/NaN because three of the formatters this replaces
 * called `toLocaleString` straight on the argument, which *throws* on null.
 * Several call sites read from nullable database columns, so that was a live
 * crash, not a hypothetical one.
 *
 * @param amount - The number to format; null/undefined/non-finite renders as `MONEY_PLACEHOLDER`
 * @param currency - The currency code (default: USD)
 * @param options - Additional Intl.NumberFormat options (e.g. whole dollars)
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string = "USD",
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return MONEY_PLACEHOLDER;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(amount);
}

/** Whole-dollar money, for headline figures where cents are noise. */
export function formatCurrencyWhole(
  amount: number | null | undefined,
  currency: string = "USD",
): string {
  return formatCurrency(amount, currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * A calendar date as `YYYY-MM-DD`, read in the viewer's own timezone.
 *
 * Do not reach for `date.toISOString().split("T")[0]` for this. That converts
 * to UTC first, so for anyone behind UTC -- every US timezone -- it returns
 * *tomorrow* from early evening onward. On this product that is not cosmetic:
 * date of service decides whether an expense clears the HSA establishment date
 * and which tax year it lands in, so a form defaulting to tomorrow can push an
 * expense into a year it does not belong to.
 */
export function toLocalISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's calendar date in the viewer's timezone, as `YYYY-MM-DD`. */
export function todayLocalISO(): string {
  return toLocalISODate(new Date());
}

/**
 * Format a number with proper thousand separators
 * @param num - The number to format
 * @param decimals - Number of decimal places (default: 0)
 */
export function formatNumber(num: number, decimals: number = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format a number as a percentage
 * @param num - The number to format (0-100)
 * @param decimals - Number of decimal places (default: 1)
 */
export function formatPercent(num: number, decimals: number = 1): string {
  return `${num.toFixed(decimals)}%`;
}

/**
 * Compact large numbers (e.g., 1000 -> 1K, 1000000 -> 1M)
 * @param num - The number to format
 */
export function formatCompactNumber(num: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
  }).format(num);
}
