import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import {
  CreditCard,
  DollarSign,
  Upload,
  PlusCircle,
  LayoutList,
} from "lucide-react";

interface QuickActionBarProps {
  hasHSA: boolean;
  hsaClaimable: number;
  unreviewedTransactions: number;
}

export function QuickActionBar({
  hasHSA,
  hsaClaimable,
  unreviewedTransactions,
}: QuickActionBarProps) {
  const navigate = useNavigate();

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
        Quick Actions
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Button
          variant="outline"
          className="h-auto min-h-[44px] py-3 flex-col gap-1"
          onClick={() => navigate("/ledger")}
        >
          <LayoutList className="h-5 w-5" />
          <span className="text-xs">Open Ledger</span>
        </Button>

        <Button
          variant="outline"
          className="h-auto min-h-[44px] py-3 flex-col gap-1"
          onClick={() => navigate("/bills/new")}
        >
          <Upload className="h-5 w-5" />
          <span className="text-xs">Upload Bill</span>
        </Button>

        <Button
          variant="outline"
          className="h-auto min-h-[44px] py-3 flex-col gap-1"
          onClick={() => navigate("/transactions")}
        >
          <CreditCard className="h-5 w-5" />
          <span className="text-xs">Review Transactions</span>
          {unreviewedTransactions > 0 && (
            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 rounded-full">
              {unreviewedTransactions}
            </span>
          )}
        </Button>

        {hasHSA && (
          <Button
            variant="outline"
            className="h-auto min-h-[44px] py-3 flex-col gap-1"
            onClick={() => navigate("/substantiation")}
          >
            <DollarSign className="h-5 w-5" />
            <span className="text-xs">Claim from HSA</span>
            {hsaClaimable > 0 && (
              <span className="text-[10px] bg-success text-success-foreground px-1.5 rounded-full">
                ${hsaClaimable.toFixed(0)}
              </span>
            )}
          </Button>
        )}

        <Button
          variant="outline"
          className="h-auto min-h-[44px] py-3 flex-col gap-1"
          onClick={() => navigate("/payments/new")}
        >
          <PlusCircle className="h-5 w-5" />
          <span className="text-xs">Log Payment</span>
        </Button>
      </div>
    </Card>
  );
}
