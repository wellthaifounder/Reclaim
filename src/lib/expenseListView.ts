/**
 * How the two expense lists on /substantiate slice their rows: grouping,
 * sorting, and filtering by who the care was for.
 *
 * A sibling of transactionGrouping.ts rather than a reuse of it. An expense
 * carries `date` (the date of service) where a transaction carries
 * `transaction_date`; it groups by provider, not merchant; and it sorts by
 * provider name as well as by date and amount — the ledger has offered
 * "Provider A–Z" since it shipped, and dropping it to share a type would be a
 * regression dressed up as tidying.
 *
 * monthLabel IS shared, because that is where the subtlety lives: `date` is a
 * DATE column, and `new Date("2026-01-01")` is UTC midnight — 31 December
 * anywhere west of Greenwich. Both modules take the month key by slicing the
 * string. Sharing the label function is what stops the two lists from drifting
 * on the one detail that would silently file a January expense under December.
 */

import { monthLabel } from "@/lib/transactionGrouping";
import type { FamilyMember } from "@/hooks/useFamilyRoster";

export const EXPENSE_GROUP_BY_OPTIONS = ["none", "provider", "month"] as const;
export type ExpenseGroupBy = (typeof EXPENSE_GROUP_BY_OPTIONS)[number];

export const EXPENSE_GROUP_BY_LABELS: Record<ExpenseGroupBy, string> = {
  none: "No grouping",
  provider: "By provider",
  month: "By month",
};

export const EXPENSE_SORT_OPTIONS = [
  "date_desc",
  "date_asc",
  "amount_desc",
  "amount_asc",
  "vendor_asc",
] as const;
export type ExpenseSortOrder = (typeof EXPENSE_SORT_OPTIONS)[number];

export const EXPENSE_SORT_LABELS: Record<ExpenseSortOrder, string> = {
  date_desc: "Newest first",
  date_asc: "Oldest first",
  amount_desc: "Largest amount",
  amount_asc: "Smallest amount",
  vendor_asc: "Provider A–Z",
};

export const DEFAULT_EXPENSE_GROUP_BY: ExpenseGroupBy = "none";
export const DEFAULT_EXPENSE_SORT: ExpenseSortOrder = "date_desc";

/** The patient filter's "no filter" value. */
export const PATIENT_ALL = "everyone";

/**
 * The toolbar state both tabs read and write.
 *
 * Owned by the page rather than by either tab: narrowing to one person on the
 * queue and switching to the full history should keep showing that person.
 * Stage and document filters stay local to the ledger — they mean nothing on a
 * queue that is already defined by its stage.
 */
export interface ExpenseListViewState {
  search: string;
  setSearch: (v: string) => void;
  patient: string;
  setPatient: (v: string) => void;
  groupBy: ExpenseGroupBy;
  setGroupBy: (v: ExpenseGroupBy) => void;
  sort: ExpenseSortOrder;
  setSort: (v: ExpenseSortOrder) => void;
}

export interface GroupableExpense {
  id: string;
  date: string;
  amount: number;
  vendor: string;
  patient_id: string | null;
  patient_name: string | null;
}

export interface ExpenseGroup<T> {
  key: string;
  label: string;
  count: number;
  total: number;
  /** Oldest and newest `date` in the group, as raw YYYY-MM-DD strings, so the
   *  caller parses them once with the date-only parser. */
  earliest: string;
  latest: string;
  items: T[];
}

export function sortExpenses<T extends GroupableExpense>(
  rows: readonly T[],
  sort: ExpenseSortOrder,
): T[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return a.date < b.date ? 1 : -1;
      case "date_asc":
        return a.date > b.date ? 1 : -1;
      case "amount_desc":
        return Number(b.amount) - Number(a.amount);
      case "amount_asc":
        return Number(a.amount) - Number(b.amount);
      case "vendor_asc":
        return a.vendor.localeCompare(b.vendor);
    }
  });
  return out;
}

export function groupExpenses<T extends GroupableExpense>(
  rows: readonly T[],
  groupBy: ExpenseGroupBy,
  sort: ExpenseSortOrder,
): ExpenseGroup<T>[] {
  const sorted = sortExpenses(rows, sort);

  if (groupBy === "none") {
    const dates = sorted.map((e) => e.date);
    return [
      {
        key: "all",
        label: "",
        count: sorted.length,
        total: sorted.reduce((sum, e) => sum + Number(e.amount), 0),
        // Lexicographic min/max, which is chronological for YYYY-MM-DD.
        earliest: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : "",
        latest: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : "",
        items: sorted,
      },
    ];
  }

  const buckets = new Map<string, ExpenseGroup<T>>();
  for (const row of sorted) {
    const key =
      groupBy === "month"
        ? row.date.slice(0, 7)
        : (row.vendor || "Unknown provider").trim();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: groupBy === "month" ? monthLabel(key) : key,
        count: 0,
        total: 0,
        earliest: row.date,
        latest: row.date,
        items: [],
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.total += Number(row.amount);
    if (row.date < bucket.earliest) bucket.earliest = row.date;
    if (row.date > bucket.latest) bucket.latest = row.date;
    bucket.items.push(row);
  }

  // Groups follow the same ordering choice the rows did, so "largest amount"
  // heads the page with the biggest provider rather than the provider that
  // merely holds the single biggest expense. Insertion order already satisfies
  // the date orders, since `sorted` fed the loop.
  const groups = [...buckets.values()];
  if (sort === "amount_desc") groups.sort((a, b) => b.total - a.total);
  else if (sort === "amount_asc") groups.sort((a, b) => a.total - b.total);
  else if (sort === "vendor_asc")
    groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

/**
 * Whether an expense belongs to the selected household member.
 *
 * Matches on patient_id, the real foreign key. The patient_name fallback is
 * for rows written before the roster existed: they carry a typed name and no
 * id, and filtering to a member would otherwise hide a user's own history from
 * them with no explanation. New rows always have the id — ExpenseSplitDialog,
 * MileageEntryForm and SubstantiationPanel all write it — so the fallback
 * covers history, not the present.
 */
export function matchesPatient(
  expense: Pick<GroupableExpense, "patient_id" | "patient_name">,
  memberId: string,
  members: readonly FamilyMember[],
): boolean {
  if (memberId === PATIENT_ALL) return true;
  if (expense.patient_id) return expense.patient_id === memberId;

  const member = members.find((m) => m.id === memberId);
  if (!member || !expense.patient_name) return false;
  return (
    expense.patient_name.trim().toLowerCase() ===
    member.name.trim().toLowerCase()
  );
}
