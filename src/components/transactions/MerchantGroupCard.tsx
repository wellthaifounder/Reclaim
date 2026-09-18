import { useState, type ReactNode } from "react";
import { ChevronDown, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import { formatFeedDate } from "@/components/transactions/reviewFeedDates";

type Props = {
  label: string;
  count: number;
  total: number;
  /** Raw YYYY-MM-DD date strings — transaction_date here, invoices.date when
   *  the expense lists use this. */
  earliest: string;
  latest: string;
  /** What the rows are. The expense lists group by provider, and "3
   *  transactions" on a card holding three expenses names the wrong object. */
  itemNoun?: string;
  children: ReactNode;
};

/**
 * One merchant on the All tab when it is grouped by merchant — the same shape
 * the review queue uses for a merchant group, so "grouped by merchant" means
 * the same thing on both screens instead of a card on one and a heading on
 * the other.
 *
 * Collapsed by default, which is the whole point: grouping by merchant is
 * what you do to answer a merchant at a time, so the list you want to scan is
 * the list of merchants. A month group is the opposite — you group by month
 * to read the months — so that one stays an open heading and only this gets a
 * collapse.
 *
 * Deliberately no "all healthcare / not healthcare" buttons, unlike the
 * review queue's version. This page already has one way to decide several
 * charges at once (tick the rows, use the bar at the top), and a second
 * control doing the same job from a different place is how the two end up
 * disagreeing about what "all" meant.
 */
export function MerchantGroupCard({
  label,
  count,
  total,
  earliest,
  latest,
  itemNoun = "transaction",
  children,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = `merchant-group-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const dateRange =
    earliest === latest
      ? formatFeedDate(earliest, "d MMM yyyy")
      : `${formatFeedDate(earliest, "d MMM yyyy")} – ${formatFeedDate(latest, "d MMM yyyy")}`;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Store
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="truncate font-medium">{label}</p>
            <Badge variant="secondary" className="text-xs">
              {count} {itemNoun}
              {count === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">
            {formatCurrency(total)} total &middot; {dateRange}
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="sm:shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? `Hide ${label}` : `Show ${count} at ${label}`}
        >
          {/* Always labelled, unlike the review queue's version of this
              button. There it sits between "All healthcare" and "Not
              healthcare" and drops to an icon below sm so the row does not
              wrap onto three lines. Here it is the only control on the card,
              so on a phone it stretches to the full width of the column — and
              a full-width bar carrying nothing but a chevron says nothing
              about what it opens. */}
          <ChevronDown
            className={cn(
              "mr-1 h-4 w-4 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span aria-hidden="true">{expanded ? "Hide" : `Show ${count}`}</span>
        </Button>
      </div>

      {expanded && (
        <div id={listId} className="mt-4 space-y-3">
          {children}
        </div>
      )}
    </Card>
  );
}
