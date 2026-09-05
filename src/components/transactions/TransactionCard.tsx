import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  onViewDetails: () => void;
  onMarkMedical?: () => void;
  onLinkToInvoice?: () => void;
  onToggleMedical?: () => void;
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
  onViewDetails,
  onMarkMedical,
  onLinkToInvoice,
  onToggleMedical,
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

  const getStatusIndicator = () => {
    switch (reconciliationStatus) {
      case "linked_to_invoice":
        return "🟢";
      case "unlinked":
        return "🟡";
      case "ignored":
        return "⚪";
    }
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{getStatusIndicator()}</span>
            <p className="font-medium text-foreground truncate">
              {vendor || description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="text-sm text-muted-foreground">
              {format(new Date(date), "MMM d, yyyy")}
            </p>
            {getStatusBadge()}
            {isMedical ? (
              <Badge
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80 transition-colors"
                onClick={onToggleMedical}
                title="Click to toggle medical status"
              >
                Medical ✓
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-muted transition-colors"
                onClick={onToggleMedical}
                title="Click to mark as medical"
              >
                Mark Medical
              </Badge>
            )}
            {isFromHsaAccount && <Badge variant="success">Paid via HSA</Badge>}
            {isHsaEligible && !isFromHsaAccount && (
              <Badge className="bg-primary/10 text-primary">HSA Eligible</Badge>
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

        <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
          <Money
            value={Math.abs(amount)}
            className="text-lg font-semibold text-foreground"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
