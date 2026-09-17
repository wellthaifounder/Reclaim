import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, Filter, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import { formatHSAAccountDateRange } from "@/lib/hsaAccountUtils";

export type FilterCriteria = {
  amountOperator?: "gt" | "lt" | "between" | "equal";
  amountMin?: number;
  amountMax?: number;
  dateOperator?: "after" | "before" | "between" | "on";
  dateStart?: Date;
  dateEnd?: Date;
  isHsaEligible?: "all" | "yes" | "no";
  hsaAccountId?: string;
  /** Spec D45. An exact merchant, picked from the ones actually on file --
   *  distinct from the search box, which matches a substring across vendor,
   *  description and amount. "CVS" typed in search also finds "CVS/pharmacy
   *  #4412" and a $12.05 charge at Kroger; picking CVS here does not. */
  merchant?: string;
};

type AdvancedFiltersProps = {
  onFilterChange: (filters: FilterCriteria) => void;
  activeFilters: FilterCriteria;
  /** Every merchant present in the caller's data, already de-duplicated and
   *  sorted. Passed in rather than queried here so the list can never offer a
   *  merchant that would return nothing. */
  merchants?: string[];
};

export function AdvancedFilters({
  onFilterChange,
  activeFilters,
  merchants = [],
}: AdvancedFiltersProps) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCriteria>(activeFilters);
  const { accounts } = useHSAAccounts();

  const hasActiveFilters = Object.keys(activeFilters).length > 0;

  const handleApply = () => {
    onFilterChange(filters);
    setOpen(false);
  };

  const handleClear = () => {
    const emptyFilters = {};
    setFilters(emptyFilters);
    onFilterChange(emptyFilters);
  };

  const updateFilter = <K extends keyof FilterCriteria>(
    key: K,
    value: FilterCriteria[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          aria-label="Advanced filters"
        >
          <Filter className="h-4 w-4" />
          {/* Label drops on a phone. Spelled out, this button took half the
              width of the search row and the search placeholder truncated to
              "Search transa". The icon carries it at that size. */}
          <span className="hidden sm:inline">Advanced Filters</span>
          {hasActiveFilters && (
            <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              Active
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* The panel is taller than the room above or below its button on a
          laptop, so Radix flipped it upward and the top ~120px -- the heading
          and the Clear button, the only way to drop a filter without
          reloading -- ended up above the top of the window. Capping it at the
          space actually available and letting it scroll is the fix; without
          this, adding any field to this panel silently pushes another one out
          of reach. */}
      <PopoverContent
        className="w-96 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto pointer-events-auto"
        align="end"
        collisionPadding={12}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Advanced Filters</h4>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Amount Filter */}
          <div className="space-y-2">
            <Label>Amount</Label>
            <Select
              value={filters.amountOperator || ""}
              onValueChange={(value) =>
                updateFilter(
                  "amountOperator",
                  value as FilterCriteria["amountOperator"],
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gt">Greater than</SelectItem>
                <SelectItem value="lt">Less than</SelectItem>
                <SelectItem value="equal">Equal to</SelectItem>
                <SelectItem value="between">Between</SelectItem>
              </SelectContent>
            </Select>

            {filters.amountOperator && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Min amount"
                  value={filters.amountMin || ""}
                  onChange={(e) =>
                    updateFilter("amountMin", parseFloat(e.target.value))
                  }
                />
                {filters.amountOperator === "between" && (
                  <Input
                    type="number"
                    placeholder="Max amount"
                    value={filters.amountMax || ""}
                    onChange={(e) =>
                      updateFilter("amountMax", parseFloat(e.target.value))
                    }
                  />
                )}
              </div>
            )}
          </div>

          {/* Merchant Filter (spec D45) */}
          {merchants.length > 0 && (
            <div className="space-y-2">
              <Label>Merchant</Label>
              <Select
                value={filters.merchant || "all"}
                onValueChange={(value) =>
                  updateFilter("merchant", value === "all" ? undefined : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All merchants" />
                </SelectTrigger>
                {/* The list is as long as the account is old, so it scrolls
                    rather than growing the popover past the viewport. */}
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All merchants</SelectItem>
                  {merchants.map((merchant) => (
                    <SelectItem key={merchant} value={merchant}>
                      {merchant}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Filter */}
          <div className="space-y-2">
            <Label>Date</Label>
            <Select
              value={filters.dateOperator || ""}
              onValueChange={(value) =>
                updateFilter(
                  "dateOperator",
                  value as FilterCriteria["dateOperator"],
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="after">After</SelectItem>
                <SelectItem value="before">Before</SelectItem>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="between">Between</SelectItem>
              </SelectContent>
            </Select>

            {filters.dateOperator && (
              <div className="space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !filters.dateStart && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {filters.dateStart
                        ? format(filters.dateStart, "PPP")
                        : "Start date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0 pointer-events-auto"
                    align="start"
                  >
                    <Calendar
                      mode="single"
                      selected={filters.dateStart}
                      onSelect={(date) => updateFilter("dateStart", date)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>

                {filters.dateOperator === "between" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !filters.dateEnd && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.dateEnd
                          ? format(filters.dateEnd, "PPP")
                          : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto p-0 pointer-events-auto"
                      align="start"
                    >
                      <Calendar
                        mode="single"
                        selected={filters.dateEnd}
                        onSelect={(date) => updateFilter("dateEnd", date)}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>

          {/* HSA Eligible Filter */}
          <div className="space-y-2">
            <Label>HSA Eligible</Label>
            <Select
              value={filters.isHsaEligible || "all"}
              onValueChange={(value) =>
                updateFilter(
                  "isHsaEligible",
                  value as FilterCriteria["isHsaEligible"],
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All transactions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transactions</SelectItem>
                <SelectItem value="yes">HSA eligible only</SelectItem>
                <SelectItem value="no">Not HSA eligible</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* HSA Account Filter */}
          {accounts.length > 0 && (
            <div className="space-y-2">
              <Label>HSA Account</Label>
              <Select
                value={filters.hsaAccountId || "all"}
                onValueChange={(value) =>
                  updateFilter(
                    "hsaAccountId",
                    value === "all" ? undefined : value,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {account.account_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatHSAAccountDateRange(account)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleApply} className="flex-1">
              Apply Filters
            </Button>
            <Button onClick={() => setOpen(false)} variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
