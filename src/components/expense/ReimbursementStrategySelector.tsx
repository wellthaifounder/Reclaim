import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoIcon, TrendingUp, Calendar, CreditCard } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDefaultReimbursementDate } from "@/lib/vaultCalculations";

interface ReimbursementStrategySelectorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  strategy: "immediate" | "medium" | "vault";
  onStrategyChange: (strategy: "immediate" | "medium" | "vault") => void;
  plannedDate: string;
  onPlannedDateChange: (date: string) => void;
  reminderDate: string;
  onReminderDateChange: (date: string) => void;
  cardPayoffMonths: number;
  onCardPayoffMonthsChange: (months: number) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  expenseDate: string;
}

export function ReimbursementStrategySelector({
  enabled,
  onEnabledChange,
  strategy,
  onStrategyChange,
  plannedDate,
  onPlannedDateChange,
  reminderDate,
  onReminderDateChange,
  cardPayoffMonths,
  onCardPayoffMonthsChange,
  notes,
  onNotesChange,
  expenseDate,
}: ReimbursementStrategySelectorProps) {
  const handleStrategyChange = (
    newStrategy: "immediate" | "medium" | "vault",
  ) => {
    onStrategyChange(newStrategy);
    // Auto-set planned date based on strategy
    const defaultDate = getDefaultReimbursementDate(newStrategy, expenseDate);
    onPlannedDateChange(defaultDate);
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="use-strategy"
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked as boolean)}
        />
        <Label
          htmlFor="use-strategy"
          className="flex items-center gap-2 cursor-pointer"
        >
          <TrendingUp className="h-4 w-4 text-primary" />
          <span>
            I'm using the "pay with rewards card, reimburse later" strategy
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p>
                  This strategy lets you pay with a rewards card, then reimburse
                  from your HSA later to maximize investment growth while
                  earning rewards.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Label>
      </div>

      {enabled && (
        <div className="ml-6 space-y-4 bg-muted/30 p-4 rounded-lg">
          <div className="space-y-2">
            <Label htmlFor="strategy">Reimbursement Strategy</Label>
            <Select
              value={strategy}
              onValueChange={(value) =>
                handleStrategyChange(value as "immediate" | "medium" | "vault")
              }
            >
              <SelectTrigger id="strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">
                  <div className="flex flex-col">
                    <span>Immediate</span>
                    <span className="text-xs text-muted-foreground">
                      Reimburse within 1 year
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="medium">
                  <div className="flex flex-col">
                    <span>Medium-term</span>
                    <span className="text-xs text-muted-foreground">
                      Reimburse in 1-3 years
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="vault">
                  <div className="flex flex-col">
                    <span>💎 Long-term Vault</span>
                    <span className="text-xs text-muted-foreground">
                      Reimburse in 3+ years for maximum growth
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="planned-date" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                When do you plan to reimburse?
              </Label>
              <Input
                id="planned-date"
                type="date"
                value={plannedDate}
                onChange={(e) => onPlannedDateChange(e.target.value)}
                min={expenseDate}
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="reminder-date"
                className="flex items-center gap-1"
              >
                <Calendar className="h-3 w-3" />
                Remind me on (optional)
              </Label>
              <Input
                id="reminder-date"
                type="date"
                value={reminderDate}
                onChange={(e) => onReminderDateChange(e.target.value)}
                min={expenseDate}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-payoff" className="flex items-center gap-1">
              <CreditCard className="h-3 w-3" />
              Card payoff period (months)
            </Label>
            <Input
              id="card-payoff"
              type="number"
              min="0"
              max="36"
              value={cardPayoffMonths}
              onChange={(e) =>
                onCardPayoffMonthsChange(parseInt(e.target.value) || 0)
              }
              placeholder="e.g., 12 for 12-month 0% APR"
            />
            <p className="text-xs text-muted-foreground">
              Enter the promotional period (e.g., 12 months for 12-month 0% APR)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="investment-notes">
              Investment strategy notes (optional)
            </Label>
            <Textarea
              id="investment-notes"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="e.g., Invested in S&P 500 index fund, targeting 8% annual return..."
              rows={2}
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100 flex items-center gap-2">
              <InfoIcon className="h-4 w-4" />
              Important Reminder
            </p>
            <p className="text-xs text-yellow-800 dark:text-yellow-200 mt-1">
              Make sure to pay off your credit card before interest kicks in!
              Keep all receipts for HSA reimbursement.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
