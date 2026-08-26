// The summary above the expense list.
//
// Rewritten 2026-08-21. It used to answer "how much of this is paid?" —
// Total Billed, Paid via HSA, Paid Other, Unpaid, with unpaid money labelled
// "Opportunity for rewards". That is the question the old bill-tracking
// product asked, and two things were wrong with it here:
//
//   1. Every expense in Reclaim is already paid. It exists because the bank
//      recorded the money leaving. "Unpaid" was a category with nothing in it,
//      and once the payments table came out it would have swallowed every
//      expense and shown the whole list in red.
//   2. It called unpaid money "Eligible for HSA Reimbursement". You cannot be
//      reimbursed for money you have not spent.
//
// The question that matters is "how much of what I have already spent can I
// still get back, and what is holding up the rest". So the bands are the
// stages of a claim, and they add up to everything spent:
//
//   Ready to claim — eligible, not yet claimed, something still owed on it.
//                    Same rule as the claimable_expenses() database function
//                    that builds the actual claim, so this figure and the one
//                    on the claim screen cannot disagree.
//   Needs work     — spent, unclaimed, but not established as eligible yet:
//                    no date of service, no patient, no documents, or a
//                    letter of medical necessity still to fetch.
//   Claimed        — in an open claim, reimbursed, or paid straight from the
//                    HSA card and therefore never reimbursable.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ExpenseMoneyRow {
  amount: number;
  amount_paid?: number | null;
  reimbursable_amount?: number | null;
  reimbursed_amount?: number | null;
  eligibility_state?: string | null;
  claim_state?: string | null;
}

const money = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * Split what the user has spent into the three stages of a claim.
 *
 * `remaining` mirrors claimable_expenses(): the reimbursable amount less
 * whatever has already come back, floored at zero, falling back through
 * amount_paid to amount when the newer columns are not set.
 */
function summariseExpenses(rows: ExpenseMoneyRow[]) {
  let readyToClaim = 0;
  let needsWork = 0;
  let claimed = 0;
  let totalSpent = 0;

  for (const row of rows) {
    const spent = Number(row.amount_paid ?? row.amount ?? 0);
    totalSpent += spent;

    const reimbursable = Number(
      row.reimbursable_amount ?? row.amount_paid ?? row.amount ?? 0,
    );
    const remaining = Math.max(
      reimbursable - Number(row.reimbursed_amount ?? 0),
      0,
    );

    const unclaimed = (row.claim_state ?? "unclaimed") === "unclaimed";

    if (!unclaimed) {
      claimed += spent;
    } else if (row.eligibility_state === "eligible" && remaining > 0) {
      readyToClaim += remaining;
    } else {
      needsWork += spent;
    }
  }

  return { readyToClaim, needsWork, claimed, totalSpent };
}

interface BillsHeroMetricsProps {
  rows: ExpenseMoneyRow[];
}

export function BillsHeroMetrics({ rows }: BillsHeroMetricsProps) {
  const { readyToClaim, needsWork, claimed, totalSpent } =
    summariseExpenses(rows);

  // The bar is drawn from the same three numbers shown as text, so it can
  // never tell a different story from the figures beside it.
  const bands = [
    {
      key: "ready",
      label: "Ready to claim",
      value: readyToClaim,
      swatch: "bg-primary",
      text: "text-primary",
      hint: "Eligible and nothing claimed against it yet",
    },
    {
      key: "needs",
      label: "Needs work",
      value: needsWork,
      swatch: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      hint: "Spent, but not established as eligible yet",
    },
    {
      key: "claimed",
      label: "Claimed",
      value: claimed,
      swatch: "bg-muted-foreground/40",
      text: "text-muted-foreground",
      hint: "In a claim, reimbursed, or paid on the HSA card",
    },
  ];

  const barTotal = bands.reduce((sum, b) => sum + b.value, 0);

  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium text-muted-foreground">
          Where your medical spending stands
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-3xl font-bold text-primary tabular-nums">
            {money(readyToClaim)}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            ready to claim, of {money(totalSpent)} spent
          </p>
        </div>

        {/* Empty state gets a flat track rather than a misleading full bar. */}
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={
            barTotal > 0
              ? bands
                  .filter((b) => b.value > 0)
                  .map((b) => `${b.label}: ${money(b.value)}`)
                  .join(", ")
              : "No expenses yet"
          }
        >
          {barTotal > 0 &&
            bands
              .filter((b) => b.value > 0)
              .map((b) => (
                <div
                  key={b.key}
                  className={b.swatch}
                  style={{ width: `${(b.value / barTotal) * 100}%` }}
                />
              ))}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {bands.map((b) => (
            <div key={b.key} className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${b.swatch}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">{b.label}</dt>
                <dd className={`text-lg font-semibold tabular-nums ${b.text}`}>
                  {money(b.value)}
                </dd>
                <p className="text-xs text-muted-foreground mt-0.5">{b.hint}</p>
              </div>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
