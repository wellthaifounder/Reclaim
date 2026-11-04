import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import { formatHSAAccountDateRange } from "@/lib/hsaAccountUtils";
import { parseDateOnly } from "@/lib/dates";
import { Calendar } from "lucide-react";

type HSAAccountSelectorProps = {
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  includeNone?: boolean;
  filterByDate?: string;
};

export function HSAAccountSelector({
  value,
  onValueChange,
  placeholder = "Select HSA account",
  disabled = false,
  includeNone = false,
  filterByDate,
}: HSAAccountSelectorProps) {
  const { accounts, isLoading } = useHSAAccounts();

  // Filter to only show active accounts and by date if provided
  let filteredAccounts = accounts.filter(
    (acc) => acc.is_active && !acc.closed_date,
  );

  // All three are calendar days. parseDateOnly reads each as local midnight;
  // `new Date("2022-03-15")` read them as UTC midnight, the evening before in
  // US time zones, and a full timestamp passed as filterByDate was then
  // compared against those shifted days (V1 launch plan, Batch 1).
  const expenseDate = parseDateOnly(filterByDate);
  if (expenseDate) {
    filteredAccounts = filteredAccounts.filter((account) => {
      const openedDate = parseDateOnly(account.opened_date);
      const closedDate = parseDateOnly(account.closed_date);

      return (
        !!openedDate &&
        expenseDate >= openedDate &&
        (!closedDate || expenseDate <= closedDate)
      );
    });
  }

  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Loading accounts..." />
        </SelectTrigger>
      </Select>
    );
  }

  if (filteredAccounts.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 border border-muted rounded-md bg-muted/20">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          No active HSA accounts. Add one in Settings.
        </span>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {includeNone && (
          <SelectItem value="none">
            <span className="text-muted-foreground">No HSA Account</span>
          </SelectItem>
        )}
        {filteredAccounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            <div className="flex flex-col">
              <span className="font-medium">{account.account_name}</span>
              <span className="text-xs text-muted-foreground">
                {formatHSAAccountDateRange(account)}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
