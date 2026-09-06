import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/ui/money";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Eye,
  Tag,
  Link2,
  XCircle,
  RotateCcw,
  ListRestart,
  Split,
  Receipt,
  HelpCircle,
  ArrowLeftRight,
  Check,
  X,
} from "lucide-react";
import { format } from "date-fns";

export interface TransactionCardProps {
  id: string;
  date: string;
  vendor: string;
  amount: number;
  description: string;
  isMedical: boolean;
  reconciliationStatus: "unlinked" | "linked_to_invoice" | "ignored";
  isHsaEligible: boolean;
  isFromHsaAccount?: boolean;
  isSplit?: boolean;
  invoiceId?: string | null;
  splitParentId?: string | null;
  splitCount?: number;
  /**
   * Workstream C3 — the "why" chip. Spec: "Every auto-decision shows why.
   * Audit-anxious users need the reasoning visible, and it makes disagreement
   * actionable rather than mysterious."
   */
  classificationExplanation?: string | null;
  /** Workstream C5 — money moved between the user's own accounts. */
  isTransfer?: boolean;
  transferKind?: string | null;
  onUnlinkTransfer?: () => void;
  /** True once the user has decided; false while it still sits in the queue. */
  needsReview?: boolean;
  /** Multi-select. Omit both and no checkbox is rendered. */
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  /** Decide this one row from the Actions column. */
  onDecide?: (isMedical: boolean) => void;
  onViewDetails: () => void;
  onMarkMedical?: () => void;
  onLinkToInvoice?: () => void;
  onIgnore?: () => void;
  onUnignore?: () => void;
  onAddToReviewQueue?: () => void;
  onSplitTransaction?: () => void;
  onSplitIntoExpenses?: () => void;
}

export function TransactionCard({
  date,
  vendor,
  amount,
  description,
  isMedical,
  reconciliationStatus,
  isHsaEligible,
  isFromHsaAccount = false,
  isSplit = false,
  invoiceId,
  splitParentId,
  splitCount,
  classificationExplanation,
  isTransfer = false,
  transferKind,
  onUnlinkTransfer,
  needsReview = false,
  selected,
  onSelectedChange,
  onDecide,
  onViewDetails,
  onMarkMedical,
  onLinkToInvoice,
  onIgnore,
  onUnignore,
  onAddToReviewQueue,
  onSplitTransaction,
  onSplitIntoExpenses,
}: TransactionCardProps) {
  const getStatusBadge = () => {
    switch (reconciliationStatus) {
      case "linked_to_invoice":
        return (
          <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">
            Tracked
          </Badge>
        );
      case "unlinked":
        return (
          <Badge
            variant="outline"
            className="border-yellow-500 text-yellow-700 dark:text-yellow-400"
          >
            Needs Linking
          </Badge>
        );
      case "ignored":
        return (
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-muted transition-colors"
            onClick={onUnignore}
            title="Click to unignore"
          >
            Ignored ✕
          </Badge>
        );
    }
  };

  // A transfer is money moved between the user's own accounts, so neither
  // decision applies to it — offering "Medical" on a credit-card payment is how
  // a double-count gets created.
  const canDecide = !!onDecide && !isTransfer && !isSplit;

  return (
    <Card className="p-3 hover:shadow-md transition-shadow group">
      {/* Stacked on a phone, side by side from sm up. Kept side by side at
          390px, the fixed-width amount-and-actions group left the vendor
          column so narrow that "Quest Diagnostics" truncated to "Quest D..."
          and every badge wrapped onto its own line. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex flex-1 min-w-0 items-start gap-3">
          {onSelectedChange && (
            <Checkbox
              className="mt-1 shrink-0"
              checked={!!selected}
              onCheckedChange={(v) => onSelectedChange(v === true)}
              aria-label={`Select ${vendor || description}`}
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">
              {vendor || description}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {format(new Date(date), "MMM d, yyyy")}
              </p>
              {/* The medical decision moved to the Actions column, where both
                answers are one press and neither is hidden behind a toggle
                whose current state you have to infer. */}
              {isMedical && !needsReview && (
                <Badge variant="secondary">Medical</Badge>
              )}
              {getStatusBadge()}
              {isFromHsaAccount && (
                <Badge variant="success">Paid via HSA</Badge>
              )}
              {isHsaEligible && !isFromHsaAccount && (
                <Badge className="bg-primary/10 text-primary">
                  HSA Eligible
                </Badge>
              )}
              {isSplit && splitCount && splitCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Split className="h-3 w-3" />
                  {splitCount} splits
                </Badge>
              )}
              {splitParentId && (
                <Badge variant="outline" className="text-xs">
                  Part of split
                </Badge>
              )}
              {isTransfer && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <ArrowLeftRight className="h-3 w-3" />
                  {transferKind === "card_payment"
                    ? "Card payment"
                    : transferKind === "hsa_distribution"
                      ? "HSA withdrawal"
                      : transferKind === "hsa_contribution"
                        ? "HSA contribution"
                        : "Transfer"}
                </Badge>
              )}
            </div>

            {classificationExplanation && (
              <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <HelpCircle
                  className="mt-0.5 h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
                <span>{classificationExplanation}</span>
              </p>
            )}

            {vendor && vendor !== description && (
              <p className="text-sm text-muted-foreground truncate">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Amount, decisions and the overflow menu sit on ONE line. Stacked,
            they made every row about twice as tall as it needed to be — and
            the menu button is invisible until hover, so a third of that height
            was reserved for something the user cannot see. */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 pl-7 sm:pl-0">
          <Money
            value={Math.abs(amount)}
            className="text-base font-semibold text-foreground tabular-nums"
          />

          {canDecide && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={isMedical && !needsReview ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => onDecide!(true)}
                aria-pressed={isMedical && !needsReview}
              >
                <Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Medical
              </Button>
              <Button
                size="sm"
                variant={
                  !isMedical &&
                  !needsReview &&
                  reconciliationStatus === "ignored"
                    ? "secondary"
                    : "outline"
                }
                className="h-7 px-2 text-xs"
                onClick={() => onDecide!(false)}
                aria-pressed={
                  !isMedical &&
                  !needsReview &&
                  reconciliationStatus === "ignored"
                }
              >
                <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Not medical
              </Button>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 bg-background z-50"
            >
              <DropdownMenuItem onClick={onViewDetails}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>

              {isTransfer && onUnlinkTransfer && (
                <DropdownMenuItem onClick={onUnlinkTransfer}>
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Not a transfer
                </DropdownMenuItem>
              )}

              {onMarkMedical && !isMedical && (
                <DropdownMenuItem onClick={onMarkMedical}>
                  <Tag className="h-4 w-4 mr-2" />
                  Mark as Medical
                </DropdownMenuItem>
              )}

              {onLinkToInvoice && reconciliationStatus === "unlinked" && (
                <DropdownMenuItem onClick={onLinkToInvoice}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Link to Bill
                </DropdownMenuItem>
              )}

              {onSplitTransaction &&
                !isSplit &&
                !splitParentId &&
                !invoiceId && (
                  <DropdownMenuItem onClick={onSplitTransaction}>
                    <Split className="h-4 w-4 mr-2" />
                    Split across HSA accounts
                  </DropdownMenuItem>
                )}

              {/* Workstream B3: splitting one payment into several expenses —
                  a mixed basket, or a bundled charge covering several visits.
                  Distinct from the HSA-account allocation split above. */}
              {onSplitIntoExpenses &&
                !isSplit &&
                !splitParentId &&
                !invoiceId && (
                  <DropdownMenuItem onClick={onSplitIntoExpenses}>
                    <Receipt className="h-4 w-4 mr-2" />
                    Split into expenses
                  </DropdownMenuItem>
                )}

              {reconciliationStatus !== "unlinked" && onAddToReviewQueue && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onAddToReviewQueue}>
                    <ListRestart className="h-4 w-4 mr-2" />
                    Add to Review Queue
                  </DropdownMenuItem>
                </>
              )}

              {reconciliationStatus === "ignored" && onUnignore && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onUnignore}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Unignore
                  </DropdownMenuItem>
                </>
              )}

              {onIgnore && reconciliationStatus !== "ignored" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onIgnore}
                    className="text-destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Ignore
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}
