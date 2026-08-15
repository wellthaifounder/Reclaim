import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTransactionSplits } from "@/hooks/useTransactionSplits";
import { formatSplitSummary } from "@/lib/transactionSplitUtils";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import type { Database } from "@/integrations/supabase/types";

type Transaction = Database["public"]["Tables"]["transactions"]["Row"];

interface SplitTransactionCardProps {
  // is_split is already on the row type; the old `& { is_split?: boolean }`
  // intersection predated that and conflicted with the row's nullability.
  transaction: Transaction;
}

export function SplitTransactionCard({
  transaction,
}: SplitTransactionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { splits, isLoading } = useTransactionSplits(transaction.id);
  const { accounts } = useHSAAccounts();

  if (!transaction.is_split || isLoading) return null;

  const getAccountName = (accountId: string | null) => {
    if (!accountId) return "No HSA Account";
    const account = accounts?.find((a) => a.id === accountId);
    return account?.account_name || "Unknown Account";
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {transaction.description}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>${transaction.amount.toFixed(2)}</span>
              <Badge variant="secondary" className="text-xs">
                {formatSplitSummary(splits || [])}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && splits && splits.length > 0 && (
        <CardContent className="space-y-2 pt-0">
          {splits.map((split, index) => (
            <div
              key={split.id}
              className="flex items-center justify-between p-3 bg-muted rounded-lg"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Split {index + 1}</span>
                  {split.hsa_account_id && (
                    <Badge variant="outline" className="text-xs">
                      {getAccountName(split.hsa_account_id)}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {split.description}
                </p>
                {split.notes && (
                  <p className="text-xs text-muted-foreground italic">
                    {split.notes}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="font-semibold">${split.amount.toFixed(2)}</p>
              </div>
            </div>
          ))}

          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-sm font-medium">Total</span>
            <span className="font-semibold">
              ${splits.reduce((sum, split) => sum + split.amount, 0).toFixed(2)}
            </span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
