// Which saved documents look like the proof for a charge
// (SUBSTANTIATE_SPEC S3, S4).
//
// A document is a likely match when the scan read an amount equal to the
// payment, to the cent, and a date on it -- the receipt date, the bill date or
// the date of care -- falls in the window around the payment: up to
// MATCH_DAYS_BEFORE days earlier (a bill is paid weeks after it is issued) and
// up to MATCH_DAYS_AFTER days later (a bank can record a card charge before
// the receipt's own date). Expensify matches on amount and date the same way.
//
// A document already backing a different expense is not a likely match: an
// amount that equals this charge is explained by the expense it is already on
// (two $25 copays at one clinic, say). It stays in the picker, unranked. A
// document larger than the payment -- a bill paid in instalments -- is not a
// match either; the picker still lists it, and S13 is where that case is
// handled.
//
// Pure, with no imports, so `node --test` can run it as-is.

export const MATCH_DAYS_BEFORE = 90;
export const MATCH_DAYS_AFTER = 7;

/** What the scan read from a document, as far as matching cares. */
export interface MatchableScan {
  scan_status: string;
  extracted_amount: number | string | null;
  extracted_date: string | null;
  extracted_bill_date: string | null;
  extracted_service_date: string | null;
  extracted_service_date_end: string | null;
}

export interface MatchableDocument {
  id: string;
  uploaded_at: string;
  scan: MatchableScan | null;
  /** Expenses other than this one that the document already backs. */
  attachedElsewhere: number;
}

/** The payment a document would prove. */
export interface Charge {
  /** The payment date, YYYY-MM-DD. */
  paidDate: string;
  /** Every figure the bank recorded for it: the charge, and this expense's
   *  share when it is one slice of a split. */
  amounts: number[];
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

/**
 * How many days the document's nearest date sits from the payment, when the
 * document is a likely match for it; null when it is not one.
 */
export function matchDistance(
  doc: MatchableDocument,
  charge: Charge,
): number | null {
  const scan = doc.scan;
  if (!scan || scan.scan_status !== "read") return null;
  if (doc.attachedElsewhere > 0) return null;

  const amount =
    scan.extracted_amount == null ? NaN : Number(scan.extracted_amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!charge.amounts.some((a) => cents(a) === cents(amount))) return null;

  let best: number | null = null;
  for (const date of [
    scan.extracted_date,
    scan.extracted_bill_date,
    scan.extracted_service_date,
    scan.extracted_service_date_end,
  ]) {
    if (!date) continue;
    // Positive when the document's date is before the payment.
    const before = daysBetween(date, charge.paidDate);
    if (before === null) continue;
    if (before > MATCH_DAYS_BEFORE || before < -MATCH_DAYS_AFTER) continue;
    const distance = Math.abs(before);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/**
 * The picker's order (S3): likely matches first, nearest date first, then
 * everything else, newest upload first.
 */
export function rankForPicker<D extends MatchableDocument>(
  docs: readonly D[],
  charge: Charge | null,
): { matches: D[]; rest: D[] } {
  const newestFirst = (a: D, b: D) =>
    b.uploaded_at.localeCompare(a.uploaded_at);
  if (!charge) return { matches: [], rest: [...docs].sort(newestFirst) };

  const scored: { doc: D; distance: number }[] = [];
  const rest: D[] = [];
  for (const doc of docs) {
    const distance = matchDistance(doc, charge);
    if (distance === null) rest.push(doc);
    else scored.push({ doc, distance });
  }
  scored.sort((a, b) => a.distance - b.distance || newestFirst(a.doc, b.doc));
  return { matches: scored.map((s) => s.doc), rest: rest.sort(newestFirst) };
}

/**
 * The one document the dialog may offer before the picker is opened (S4):
 * only when exactly one document matches. Two equally good candidates is a
 * choice for the person, made in the picker, where both are listed first.
 */
export function clearMatch<D extends MatchableDocument>(
  docs: readonly D[],
  charge: Charge | null,
): D | null {
  const { matches } = rankForPicker(docs, charge);
  return matches.length === 1 ? matches[0] : null;
}
