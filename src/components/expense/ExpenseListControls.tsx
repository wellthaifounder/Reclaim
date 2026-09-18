import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import {
  EXPENSE_GROUP_BY_LABELS,
  EXPENSE_GROUP_BY_OPTIONS,
  EXPENSE_SORT_LABELS,
  EXPENSE_SORT_OPTIONS,
  PATIENT_ALL,
  type ExpenseGroupBy,
  type ExpenseSortOrder,
} from "@/lib/expenseListView";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  patient: string;
  onPatientChange: (v: string) => void;
  groupBy: ExpenseGroupBy;
  onGroupByChange: (v: ExpenseGroupBy) => void;
  sort: ExpenseSortOrder;
  onSortChange: (v: ExpenseSortOrder) => void;
  searchPlaceholder: string;
  /** Selects only one tab needs — the ledger's stage and document filters. */
  children?: ReactNode;
}

/**
 * The toolbar both tabs share.
 *
 * Search, patient, grouping and sort are rendered from state the page owns, so
 * narrowing to one person on the queue and switching to the full history keeps
 * showing that person rather than silently widening back to the household.
 */
export function ExpenseListControls({
  search,
  onSearchChange,
  patient,
  onPatientChange,
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
  searchPlaceholder,
  children,
}: Props) {
  const { members } = useFamilyRoster();

  // A one-person roster has nothing to choose between, and every household
  // starts as one person. The control appears when it can do something.
  const showPatient = members.length > 1;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
          aria-label="Search expenses"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:shrink-0">
        {showPatient && (
          <Select value={patient} onValueChange={onPatientChange}>
            <SelectTrigger
              className="sm:w-[150px]"
              aria-label="Filter by who it was for"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PATIENT_ALL}>Everyone</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {children}

        <Select
          value={groupBy}
          onValueChange={(v) => onGroupByChange(v as ExpenseGroupBy)}
        >
          <SelectTrigger className="sm:w-[150px]" aria-label="Group expenses">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_GROUP_BY_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>
                {EXPENSE_GROUP_BY_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(v) => onSortChange(v as ExpenseSortOrder)}
        >
          <SelectTrigger className="sm:w-[160px]" aria-label="Sort expenses">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_SORT_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {EXPENSE_SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
