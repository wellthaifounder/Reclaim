import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Layers, ListFilter } from "lucide-react";
import {
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_LABELS,
  type TransactionStatus,
} from "@/lib/transactionStatus";
import {
  GROUP_BY_LABELS,
  GROUP_BY_OPTIONS,
  SORT_LABELS,
  SORT_OPTIONS,
  type GroupBy,
  type SortOrder,
} from "@/lib/transactionGrouping";

type Props = {
  status: TransactionStatus;
  counts: Record<TransactionStatus, number>;
  onStatusChange: (next: TransactionStatus) => void;
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  sort: SortOrder;
  onSortChange: (next: SortOrder) => void;
};

/**
 * Spec D42 and D45 — the three controls over the All list.
 *
 * The counts on the status filter are D44 doing its job. They replace the
 * one-time sentence that used to appear on an empty review queue ("we also
 * filed 231 charges as not healthcare — worth a look?"), which could only be
 * seen by someone who had already emptied their queue and happened to read
 * it. A number sitting permanently beside the filter cannot nag, stays true
 * as the pile changes, and is stumbled onto by the person who does not know
 * the pile exists — which is the person who needs it.
 *
 * They are also why the count is rendered inside SelectItem rather than only
 * on the trigger: the point is to be visible while choosing, not after.
 */
export function TransactionListControls({
  status,
  counts,
  onStatusChange,
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* On a phone the status filter takes a row of its own -- it carries the
          counts and is the one people actually reach for -- and group and sort
          share the row below it rather than stacking into a third. */}
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <ListFilter
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as TransactionStatus)}
        >
          <SelectTrigger
            className="h-8 w-full text-sm sm:w-[200px]"
            aria-label="Filter by status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSACTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="flex w-full items-center justify-between gap-6">
                  <span>{TRANSACTION_STATUS_LABELS[s]}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {counts[s]}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
        <Layers
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <Select
          value={groupBy}
          onValueChange={(v) => onGroupByChange(v as GroupBy)}
        >
          <SelectTrigger
            className="h-8 w-full text-sm sm:w-[150px]"
            aria-label="Group transactions"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
        <ArrowUpDown
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <Select
          value={sort}
          onValueChange={(v) => onSortChange(v as SortOrder)}
        >
          <SelectTrigger
            className="h-8 w-full text-sm sm:w-[150px]"
            aria-label="Sort transactions"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
