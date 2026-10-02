// Which saved documents look like the proof for a charge
// (SUBSTANTIATE_SPEC S3, S4; rules amended with the founder 2026-10-02).
//
// A document is a likely match in one of two ways:
//
//   A. Same amount. The scan read an amount equal to the payment, to the
//      cent -- the expense's own figures, or the full bank charge for one
//      share of a split -- and a date on the document falls between
//      MATCH_DAYS_BEFORE days before the payment and MATCH_DAYS_AFTER days
//      after it (a bank can record a card charge before the receipt's date).
//      The limit stops a two-year-old $25 copay receipt being offered on
//      today's $25 copay.
//
//   B. Payment plan. The document is already being paid off in parts: it
//      backs another payment to the same provider for less than its own
//      total, and what it backs so far adds up to less than that total. A
//      hospital statement attached to the first instalment is then offered on
//      every later one, with no date limit, until the plan is paid. A receipt
//      backing the one charge it equals is not a payment plan, so a CVS
//      receipt is never offered on the next CVS purchase.
//
// A document already on another expense can still match (the founder's call:
// one statement routinely backs dozens of instalments). Same-amount matches
// rank first, nearest date first; payment plans follow.
//
// Pure, with no imports, so `node --test` can run it as-is.

export const MATCH_DAYS_BEFORE = 365;
export const MATCH_DAYS_AFTER = 7;

export type ScanStatus = "read" | "unreadable";

/** What the scan read from a document, as far as matching cares. */
export interface MatchableScan {
  scan_status: string;
  extracted_amount: number | string | null;
  extracted_vendor?: string | null;
  extracted_date: string | null;
  extracted_bill_date: string | null;
  extracted_service_date: string | null;
  extracted_service_date_end: string | null;
}

/** True when the scan read the document (not unreadable, not unread). */
export function isRead<S extends { scan_status: string }>(
  scan: S | null | undefined,
): scan is S {
  const read: ScanStatus = "read";
  return scan?.scan_status === read;
}

/**
 * The dates on a document, in the order a person would know it by: the
 * receipt's own date, the bill date, then the dates of care.
 */
export function documentDates(scan: MatchableScan | null): string[] {
  if (!isRead(scan)) return [];
  return [
    scan.extracted_date,
    scan.extracted_bill_date,
    scan.extracted_service_date,
    scan.extracted_service_date_end,
  ].filter((d): d is string => !!d);
}

/** An expense a document already backs. */
export interface Backing {
  invoiceId: string;
  vendor: string | null;
  vendorOriginal: string | null;
  /** What that expense paid. */
  amount: number | null;
}

export interface MatchableDocument {
  id: string;
  uploaded_at: string;
  scan: MatchableScan | null;
  backs: Backing[];
}

/** The payment a document would prove. */
export interface Charge {
  invoiceId: string;
  /** The payment date, YYYY-MM-DD: the bank's, when there is a bank record --
   *  a split expense's own date is its date of care. */
  paidDate: string;
  /** Every figure the payment is known by: the expense's own, and the full
   *  bank charge when the expense is one share of a split. */
  amounts: number[];
  /** The provider as the bank and the expense name it. */
  providerNames: string[];
}

const cents = (n: number) => Math.round(n * 100);

/** Whole days from a to b; null if either is not a YYYY-MM-DD date. */
function daysBetween(a: string, b: string): number | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const from = parse(a);
  const to = parse(b);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86_400_000);
}

/** Words bank text adds around a provider's name. */
const NOISE = new Set([
  "sq",
  "pmt",
  "payment",
  "pos",
  "debit",
  "purchase",
  "ach",
]);

/**
 * A provider's name reduced to what stays the same from one payment to the
 * next: "MERCY HOSP PMT 0923" and "MERCY HOSP PMT 1023" are both "mercy hosp".
 */
export function providerKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .join(" ");
}

/** True when any name on one side is the same provider as any on the other. */
export function sameProvider(
  a: readonly (string | null | undefined)[],
  b: readonly (string | null | undefined)[],
): boolean {
  const keysA = a.map(providerKey).filter(Boolean);
  const keysB = b.map(providerKey).filter(Boolean);
  return keysA.some((x) =>
    keysB.some((y) => {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      return short.length >= 4 && long.includes(short);
    }),
  );
}

export type MatchReason =
  { kind: "amount"; distance: number } | { kind: "plan" };

/** Why the document is a likely match for the charge; null when it is not. */
export function matchReason(
  doc: MatchableDocument,
  charge: Charge,
): MatchReason | null {
  const scan = doc.scan;
  if (!isRead(scan)) return null;
  if (doc.backs.some((b) => b.invoiceId === charge.invoiceId)) return null;

  const total =
    scan.extracted_amount == null ? NaN : Number(scan.extracted_amount);
  if (!Number.isFinite(total) || total <= 0) return null;

  // A. Same amount, dated around the payment.
  if (charge.amounts.some((a) => cents(a) === cents(total))) {
    let best: number | null = null;
    for (const date of documentDates(scan)) {
      // Positive when the document's date is before the payment.
      const before = daysBetween(date, charge.paidDate);
      if (before === null) continue;
      if (before > MATCH_DAYS_BEFORE || before < -MATCH_DAYS_AFTER) continue;
      const distance = Math.abs(before);
      if (best === null || distance < best) best = distance;
    }
    if (best !== null) return { kind: "amount", distance: best };
  }

  // B. A payment plan still being paid off, from the same provider.
  const paidSoFar = doc.backs.reduce((sum, b) => sum + (b.amount ?? 0), 0);
  const isInstalmentOfThis = doc.backs.some(
    (b) =>
      b.amount != null &&
      cents(b.amount) < cents(total) &&
      sameProvider(charge.providerNames, [
        b.vendorOriginal,
        b.vendor,
        scan.extracted_vendor,
      ]),
  );
  if (isInstalmentOfThis && cents(paidSoFar) < cents(total)) {
    return { kind: "plan" };
  }
  return null;
}

/**
 * The picker's order (S3): same-amount matches first, nearest date first;
 * then payment plans, newest first; then everything else, newest first.
 */
export function rankForPicker<D extends MatchableDocument>(
  docs: readonly D[],
  charge: Charge | null,
): { matches: D[]; rest: D[] } {
  const newestFirst = (a: D, b: D) =>
    b.uploaded_at.localeCompare(a.uploaded_at);
  if (!charge) return { matches: [], rest: [...docs].sort(newestFirst) };

  const byAmount: { doc: D; distance: number }[] = [];
  const plans: D[] = [];
  const rest: D[] = [];
  for (const doc of docs) {
    const reason = matchReason(doc, charge);
    if (!reason) rest.push(doc);
    else if (reason.kind === "amount")
      byAmount.push({ doc, distance: reason.distance });
    else plans.push(doc);
  }
  byAmount.sort((a, b) => a.distance - b.distance || newestFirst(a.doc, b.doc));
  return {
    matches: [...byAmount.map((m) => m.doc), ...plans.sort(newestFirst)],
    rest: rest.sort(newestFirst),
  };
}

/**
 * What the expense offers before the picker is opened (S4): one document by
 * name, or "N look like a match" when there are several -- two photos of one
 * receipt, or an invoice and its payment record. Never attached by itself.
 */
export function likelyMatches<D extends MatchableDocument>(
  docs: readonly D[],
  charge: Charge | null,
): D[] {
  return rankForPicker(docs, charge).matches;
}

/** How many older documents one visit may read in the background. */
export const CATCH_UP_PER_SESSION = 25;

/**
 * Saved documents never read and on no expense, which the Documents page reads
 * in the background so they can be matched. Documents saved before reading at
 * upload existed (S6) have no reading, and an unread document can never be a
 * likely match. One on an expense is left alone: it is read when it is
 * attached or when Scan is pressed on it.
 *
 * Oldest first, so a long backlog works through in a steady order. `tried` is
 * what this visit's catch-up already attempted, and counts against `limit`;
 * `claimed` is what an upload is reading itself, which is skipped but does
 * not use up the allowance.
 */
export function documentsToCatchUp<
  D extends {
    id: string;
    uploaded_at: string;
    scan: unknown;
    backs: unknown[];
  },
>(
  docs: readonly D[],
  tried: ReadonlySet<string>,
  claimed: ReadonlySet<string> = new Set(),
  limit = CATCH_UP_PER_SESSION,
): D[] {
  const room = Math.max(0, limit - tried.size);
  return docs
    .filter(
      (d) =>
        d.scan == null &&
        d.backs.length === 0 &&
        !tried.has(d.id) &&
        !claimed.has(d.id),
    )
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .slice(0, room);
}
