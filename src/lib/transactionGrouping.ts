/**
 * Spec D45: group by (none / merchant / month) and sort (date / amount) for
 * the All-transactions list. Lands ungrouped, newest first — the defaults
 * below.
 *
 * Kept out of the page for one reason worth stating: a transaction_date is a
 * DATE column, i.e. a calendar day with no time and no zone. `new Date(
 * "2026-01-01")` parses that as UTC midnight, which is 31 December in every
 * timezone west of Greenwich — so a January charge would head a December
 * group for anyone in the Americas. The month key is taken by slicing the
 * string, never by constructing a Date.
 */

export const GROUP_BY_OPTIONS = ["none", "merchant", "month"] as const;
export type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  merchant: "By merchant",
  month: "By month",
};

export const SORT_OPTIONS = [
  "date_desc",
  "date_asc",
  "amount_desc",
  "amount_asc",
] as const;
export type SortOrder = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOrder, string> = {
  date_desc: "Newest first",
  date_asc: "Oldest first",
  amount_desc: "Largest first",
  amount_asc: "Smallest first",
};

export const DEFAULT_GROUP_BY: GroupBy = "none";
export const DEFAULT_SORT: SortOrder = "date_desc";

export interface GroupableTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  vendor: string | null;
  description: string;
}

export interface TransactionGroup<T> {
  key: string;
  label: string;
  count: number;
  total: number;
  /** Oldest and newest transaction_date in the group, as the raw YYYY-MM-DD
   *  strings. Kept as strings so the caller parses them once, with the
   *  date-only parser, rather than this module guessing at a timezone. */
  earliest: string;
  latest: string;
  items: T[];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-17" → "September 2026", without ever building a Date. */
function monthLabel(yyyymm: string): string {
  const [year, month] = yyyymm.split("-");
  const index = Number(month) - 1;
  return MONTH_NAMES[index] ? `${MONTH_NAMES[index]} ${year}` : yyyymm;
}

export function sortTransactions<T extends GroupableTransaction>(
  rows: readonly T[],
  sort: SortOrder,
): T[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return a.transaction_date < b.transaction_date ? 1 : -1;
      case "date_asc":
        return a.transaction_date > b.transaction_date ? 1 : -1;
      case "amount_desc":
        return Number(b.amount) - Number(a.amount);
      case "amount_asc":
        return Number(a.amount) - Number(b.amount);
    }
  });
  return out;
}

export function groupTransactions<T extends GroupableTransaction>(
  rows: readonly T[],
  groupBy: GroupBy,
  sort: SortOrder,
): TransactionGroup<T>[] {
  const sorted = sortTransactions(rows, sort);
  if (groupBy === "none") {
    const dates = sorted.map((t) => t.transaction_date);
    return [
      {
        key: "all",
        label: "",
        count: sorted.length,
        total: sorted.reduce((sum, t) => sum + Number(t.amount), 0),
        // Sorted lexicographically, which is chronological for YYYY-MM-DD.
        earliest: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : "",
        latest: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : "",
        items: sorted,
      },
    ];
  }

  const buckets = new Map<string, TransactionGroup<T>>();
  for (const row of sorted) {
    const key =
      groupBy === "month"
        ? row.transaction_date.slice(0, 7)
        : (row.vendor || row.description || "Unknown").trim();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: groupBy === "month" ? monthLabel(key) : key,
        count: 0,
        total: 0,
        earliest: row.transaction_date,
        latest: row.transaction_date,
        items: [],
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.total += Number(row.amount);
    if (row.transaction_date < bucket.earliest)
      bucket.earliest = row.transaction_date;
    if (row.transaction_date > bucket.latest)
      bucket.latest = row.transaction_date;
    bucket.items.push(row);
  }

  // Groups are ordered by the same choice that ordered the rows, so "largest
  // first" means the biggest merchant heads the page rather than the merchant
  // that merely happens to contain the single biggest charge. Insertion order
  // already satisfies the date orders, since `sorted` fed this loop.
  const groups = [...buckets.values()];
  if (sort === "amount_desc") groups.sort((a, b) => b.total - a.total);
  else if (sort === "amount_asc") groups.sort((a, b) => a.total - b.total);
  return groups;
}
