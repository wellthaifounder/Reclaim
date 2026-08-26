import { useState } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Calendar,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TableColumnHeaderProps {
  title: string;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: "text" | "date" | "number";
  filterOptions?: string[]; // Available options for text filters (autocomplete)
  minValue?: number; // Min value for number filters
  maxValue?: number; // Max value for number filters
  currentSort?: "asc" | "desc" | null;
  onSort?: (direction: "asc" | "desc") => void;
  onFilter?: (value: any) => void;
  filterValue?: any;
}

export function TableColumnHeader({
  title,
  sortable = false,
  filterable = false,
  filterType = "text",
  filterOptions = [],
  minValue,
  maxValue,
  currentSort,
  onSort,
  onFilter,
  filterValue,
}: TableColumnHeaderProps) {
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [textFilter, setTextFilter] = useState(filterValue || "");
  const [numberFrom, setNumberFrom] = useState<string>("");
  const [numberTo, setNumberTo] = useState<string>("");
  const [, setComboboxOpen] = useState(false);

  const handleTextFilterApply = () => {
    onFilter?.(textFilter);
  };

  const handleDateRangeApply = () => {
    if (dateFrom && dateTo) {
      onFilter?.({ from: dateFrom, to: dateTo });
    } else if (dateFrom) {
      onFilter?.(dateFrom);
    }
  };

  const handleNumberRangeApply = () => {
    const from = numberFrom ? parseFloat(numberFrom) : minValue;
    const to = numberTo ? parseFloat(numberTo) : maxValue;
    onFilter?.({ from, to });
  };

  const handleClearFilter = () => {
    setTextFilter("");
    setDateFrom(undefined);
    setDateTo(undefined);
    setNumberFrom("");
    setNumberTo("");
    onFilter?.(null);
  };

  if (!sortable && !filterable) {
    return <span className="font-medium">{title}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
        >
          <span>{title}</span>
          {currentSort === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : currentSort === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {sortable && (
          <>
            <DropdownMenuItem onClick={() => onSort?.("asc")}>
              <ArrowUp className="mr-2 h-4 w-4" />
              Sort Ascending
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSort?.("desc")}>
              <ArrowDown className="mr-2 h-4 w-4" />
              Sort Descending
            </DropdownMenuItem>
          </>
        )}
        {sortable && filterable && <DropdownMenuSeparator />}
        {filterable && (
          <>
            {filterType === "text" && filterOptions.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 p-0">
                  <Command>
                    <CommandInput
                      placeholder={`Search ${title.toLowerCase()}...`}
                    />
                    <CommandList>
                      <CommandEmpty>No results found.</CommandEmpty>
                      <CommandGroup>
                        {filterOptions.map((option) => (
                          <CommandItem
                            key={option}
                            value={option}
                            onSelect={(currentValue) => {
                              const newValue =
                                currentValue === textFilter.toLowerCase()
                                  ? ""
                                  : option;
                              setTextFilter(newValue);
                              onFilter?.(newValue);
                              setComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                textFilter.toLowerCase() ===
                                  option.toLowerCase()
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {option}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                  {textFilter && (
                    <div className="p-2 border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearFilter}
                        className="w-full"
                      >
                        Clear Filter
                      </Button>
                    </div>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {filterType === "text" && filterOptions.length === 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 p-2">
                  <Input
                    placeholder={`Filter ${title.toLowerCase()}...`}
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    className="mb-2"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleTextFilterApply}
                      className="flex-1"
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClearFilter}
                      className="flex-1"
                    >
                      Clear
                    </Button>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {filterType === "date" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Calendar className="mr-2 h-4 w-4" />
                  Filter Date
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-auto p-3">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">From Date</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {dateFrom ? format(dateFrom, "PPP") : "Select date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={dateFrom}
                            onSelect={setDateFrom}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        To Date (Optional)
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {dateTo ? format(dateTo, "PPP") : "Select date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={dateTo}
                            onSelect={setDateTo}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={handleDateRangeApply}
                        className="flex-1"
                      >
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearFilter}
                        className="flex-1"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {filterType === "number" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter Range
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 p-3">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Min Amount</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={minValue ? `${minValue}` : "Min"}
                        value={numberFrom}
                        onChange={(e) => setNumberFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Amount</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={maxValue ? `${maxValue}` : "Max"}
                        value={numberTo}
                        onChange={(e) => setNumberTo(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={handleNumberRangeApply}
                        className="flex-1"
                      >
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearFilter}
                        className="flex-1"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
