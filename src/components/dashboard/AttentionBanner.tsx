import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, ChevronDown, ChevronUp, X } from "lucide-react";
import type { AttentionSummary } from "@/hooks/useAttentionItems";

interface AttentionBannerProps {
  attention: AttentionSummary;
}

export function AttentionBanner({ attention }: AttentionBannerProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (
    dismissed ||
    attention.isLoading ||
    (attention.totalCount === 0 && attention.hsaClaimable === 0)
  ) {
    return null;
  }

  return (
    <Alert className="mb-6 bg-blue-500/10 border-blue-500/20">
      <Bell className="h-4 w-4 text-blue-600" />
      <AlertTitle className="text-blue-900 dark:text-blue-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>
              {attention.totalCount} item{attention.totalCount !== 1 ? "s" : ""}{" "}
              need your attention
            </span>
            {attention.hsaClaimable > 0 && (
              <Badge
                variant="outline"
                className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
              >
                ${attention.hsaClaimable.toLocaleString()} HSA claimable
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="h-8 w-8 p-0"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </AlertTitle>

      {expanded && (
        <AlertDescription className="mt-3 text-blue-800 dark:text-blue-200">
          <div className="space-y-2">
            {attention.unreviewedTransactions > 0 && (
              <div className="flex items-center justify-between">
                <span>
                  {attention.unreviewedTransactions} transaction
                  {attention.unreviewedTransactions !== 1 ? "s" : ""} to review
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/expenses?tab=review")}
                >
                  Review
                </Button>
              </div>
            )}
            {attention.unlinkedMedical > 0 && (
              <div className="flex items-center justify-between">
                <span>
                  {attention.unlinkedMedical} medical transaction
                  {attention.unlinkedMedical !== 1 ? "s" : ""} not linked to
                  bills
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/expenses?tab=review")}
                >
                  Link
                </Button>
              </div>
            )}
            {/* "N unpaid bills older than 30 days" removed 2026-08-21 — see
                the note in useAttentionItems. The column behind it stopped
                being maintained, and the idea never applied to an expense the
                bank has already shown as paid. */}
            {attention.hsaClaimable > 0 && (
              <div className="flex items-center justify-between">
                <span>
                  ${attention.hsaClaimable.toLocaleString()} in HSA-eligible
                  expenses ready to claim
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/substantiation")}
                >
                  Claim
                </Button>
              </div>
            )}
          </div>
        </AlertDescription>
      )}
    </Alert>
  );
}
