import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

interface PaymentPlanFieldsProps {
  hasPaymentPlan: boolean;
  onHasPaymentPlanChange: (value: boolean) => void;
  totalAmount: string;
  onTotalAmountChange: (value: string) => void;
  installments: string;
  onInstallmentsChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  currentAmount: string;
}

export function PaymentPlanFields({
  hasPaymentPlan,
  onHasPaymentPlanChange,
  totalAmount,
  onTotalAmountChange,
  installments,
  onInstallmentsChange,
  notes,
  onNotesChange,
  currentAmount,
}: PaymentPlanFieldsProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="payment-plan"
            checked={hasPaymentPlan}
            onCheckedChange={onHasPaymentPlanChange}
          />
          <div>
            <Label
              htmlFor="payment-plan"
              className="text-base font-semibold cursor-pointer"
            >
              This expense is on a payment plan
            </Label>
            <CardDescription className="mt-1">
              Track installment payments for large medical bills
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      {hasPaymentPlan && (
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enter the <strong>full bill amount</strong> and number of
              installments. Each payment you make should be tracked as a
              separate entry with payment receipts.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="total-amount">Total Bill Amount</Label>
              <Input
                id="total-amount"
                type="number"
                step="0.01"
                placeholder="5000.00"
                value={totalAmount}
                onChange={(e) => onTotalAmountChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The full amount from your medical bill
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="installments">Number of Installments</Label>
              <Input
                id="installments"
                type="number"
                min="2"
                placeholder="12"
                value={installments}
                onChange={(e) => onInstallmentsChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How many payments total?
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-plan-notes">Payment Plan Details</Label>
            <Textarea
              id="payment-plan-notes"
              placeholder="e.g., $416.67/month for 12 months starting March 2025"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
            />
          </div>

          {totalAmount && installments && parseFloat(currentAmount) > 0 && (
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">Payment Plan Summary</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Amount:</p>
                  <Money
                    value={parseFloat(totalAmount)}
                    className="block font-semibold"
                  />
                </div>
                <div>
                  <p className="text-muted-foreground">This Payment:</p>
                  <Money
                    value={parseFloat(currentAmount)}
                    className="block font-semibold"
                  />
                </div>
                <div>
                  <p className="text-muted-foreground">Installments:</p>
                  <p className="font-semibold">{installments} payments</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Per Payment:</p>
                  <p className="font-semibold">
                    $
                    {(
                      parseFloat(totalAmount) / parseFloat(installments)
                    ).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
