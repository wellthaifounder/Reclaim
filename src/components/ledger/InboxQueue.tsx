import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Wallet,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
} from "lucide-react";
import { useInboxItems, type InboxItem } from "@/hooks/useInboxItems";
import { useInboxKeyboardShortcuts } from "@/hooks/useInboxKeyboardShortcuts";

const ITEM_TYPE_CONFIG: Record<
  string,
  { icon: typeof Wallet; color: string; bgColor: string }
> = {
  review_transaction: {
    icon: Wallet,
    color: "text-blue-600",
    bgColor: "bg-blue-500/10",
  },
  overdue_unpaid: {
    icon: AlertCircle,
    color: "text-red-600",
    bgColor: "bg-red-500/10",
  },
  hsa_claimable: {
    icon: ShieldCheck,
    color: "text-purple-600",
    bgColor: "bg-purple-500/10",
  },
};

function InboxItemCard({
  item,
  isFocused,
  isSelected,
  isActing,
  onToggleSelect,
  onAct,
  onDismiss,
  onNavigate,
}: {
  item: InboxItem;
  isFocused: boolean;
  isSelected: boolean;
  isActing: boolean;
  onToggleSelect: () => void;
  onAct: (action: string) => void;
  onDismiss: () => void;
  onNavigate: (path: string) => void;
}) {
  const config =
    ITEM_TYPE_CONFIG[item.item_type] || ITEM_TYPE_CONFIG.review_transaction;
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
        isFocused
          ? "ring-2 ring-primary ring-offset-1 bg-accent/50"
          : "hover:bg-accent/30"
      } ${isSelected ? "bg-accent/40 border-primary/40" : ""}`}
    >
      {/* Checkbox (not for virtual items) */}
      {!item.isVirtual ? (
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
          disabled={isActing}
          aria-label={`Select ${item.title}`}
        />
      ) : (
        <div className="w-4" />
      )}

      {/* Type icon */}
      <div className={`p-1.5 rounded-md ${config.bgColor}`}>
        <Icon className={`h-4 w-4 ${config.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.title}</p>
        {item.subtitle && (
          <p className="text-xs text-muted-foreground truncate">
            {item.subtitle}
          </p>
        )}
      </div>

      {/* Amount */}
      {item.amount != null && (
        <span className="text-sm font-semibold whitespace-nowrap">
          ${Math.abs(item.amount).toFixed(2)}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {isActing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {item.item_type === "review_transaction" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct("medical");
                  }}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Medical
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct("not_medical");
                  }}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Not
                </Button>
              </>
            )}
            {item.isVirtual && item.suggested_action?.path && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate(item.suggested_action!.path as string);
                }}
              >
                View
              </Button>
            )}
            {!item.isVirtual && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BatchActionBar({
  selectedCount,
  hasReviewItems,
  onBatchMedical,
  onBatchNotMedical,
  onBatchDismiss,
  onClearSelection,
}: {
  selectedCount: number;
  hasReviewItems: boolean;
  onBatchMedical: () => void;
  onBatchNotMedical: () => void;
  onBatchDismiss: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/80 rounded-lg border border-dashed">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="flex items-center gap-1.5 ml-auto">
        {hasReviewItems && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onBatchMedical}
            >
              Mark Medical
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onBatchNotMedical}
            >
              Not Medical
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onBatchDismiss}
        >
          Dismiss All
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onClearSelection}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function InboxQueue() {
  const navigate = useNavigate();
  const inbox = useInboxItems();
  const { items, isLoading, actOnItem, dismissItem, batchAct, batchDismiss } =
    inbox;

  const [expanded, setExpanded] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // Reset focus when items change
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, focusedIndex]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const selectableIds = items.filter((i) => !i.isVirtual).map((i) => i.id);
    if (selectedIds.size === selectableIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }, [items, selectedIds.size]);

  const handleActOnItem = useCallback(
    async (item: InboxItem, action: string) => {
      setActingIds((prev) => new Set(prev).add(item.id));
      await actOnItem(item, action);
      setActingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    },
    [actOnItem],
  );

  const handleDismissItem = useCallback(
    async (item: InboxItem) => {
      setActingIds((prev) => new Set(prev).add(item.id));
      await dismissItem(item);
      setActingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    },
    [dismissItem],
  );

  const handleBatchAct = useCallback(
    async (batchItems: InboxItem[], action: string) => {
      for (const item of batchItems) {
        setActingIds((prev) => new Set(prev).add(item.id));
      }
      await batchAct(batchItems, action);
      setActingIds(new Set());
      setSelectedIds(new Set());
    },
    [batchAct],
  );

  const handleBatchDismiss = useCallback(
    async (batchItems: InboxItem[]) => {
      for (const item of batchItems) {
        setActingIds((prev) => new Set(prev).add(item.id));
      }
      await batchDismiss(batchItems);
      setActingIds(new Set());
      setSelectedIds(new Set());
    },
    [batchDismiss],
  );

  useInboxKeyboardShortcuts({
    items,
    focusedIndex,
    selectedIds,
    expanded,
    onFocusChange: setFocusedIndex,
    onToggleSelect: handleToggleSelect,
    onSelectAll: handleSelectAll,
    onActOnItem: handleActOnItem,
    onDismissItem: handleDismissItem,
    onBatchAct: handleBatchAct,
    onBatchDismiss: handleBatchDismiss,
    onToggleExpand: () => setExpanded((prev) => !prev),
  });

  if (isLoading) {
    return null;
  }

  if (items.length === 0) {
    return (
      <Card className="border-green-500/20 bg-green-500/5">
        <div className="flex items-center gap-2 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm text-muted-foreground">
            Inbox clear — no items need your attention
          </span>
        </div>
      </Card>
    );
  }

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const hasReviewItems = selectedItems.some(
    (i) => i.item_type === "review_transaction",
  );

  return (
    <Card className="overflow-hidden border-blue-500/20 bg-blue-500/5">
      {/* Header */}
      <button
        aria-label={expanded ? "Collapse inbox queue" : "Expand inbox queue"}
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">
            {items.length} item{items.length !== 1 ? "s" : ""} need your
            attention
          </span>
          {items.some((i) => i.item_type === "hsa_claimable") && (
            <Badge
              variant="outline"
              className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs"
            >
              HSA claimable
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expanded && items.filter((i) => !i.isVirtual).length > 0 && (
            <div
              className="flex items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={
                  selectedIds.size > 0 &&
                  selectedIds.size === items.filter((i) => !i.isVirtual).length
                }
                onCheckedChange={handleSelectAll}
                aria-label="Select all"
              />
              <span className="text-xs text-muted-foreground">All</span>
            </div>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5" ref={listRef}>
          {items.map((item, index) => (
            <InboxItemCard
              key={item.id}
              item={item}
              isFocused={focusedIndex === index}
              isSelected={selectedIds.has(item.id)}
              isActing={actingIds.has(item.id)}
              onToggleSelect={() => handleToggleSelect(item.id)}
              onAct={(action) => handleActOnItem(item, action)}
              onDismiss={() => handleDismissItem(item)}
              onNavigate={(path) => navigate(path)}
            />
          ))}

          {/* Batch action bar */}
          {selectedIds.size > 0 && (
            <BatchActionBar
              selectedCount={selectedIds.size}
              hasReviewItems={hasReviewItems}
              onBatchMedical={() =>
                handleBatchAct(
                  selectedItems.filter(
                    (i) => i.item_type === "review_transaction",
                  ),
                  "medical",
                )
              }
              onBatchNotMedical={() =>
                handleBatchAct(
                  selectedItems.filter(
                    (i) => i.item_type === "review_transaction",
                  ),
                  "not_medical",
                )
              }
              onBatchDismiss={() => handleBatchDismiss(selectedItems)}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          )}

          {/* Keyboard hints */}
          <div className="flex items-center justify-center gap-3 pt-1.5 text-[10px] text-muted-foreground">
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">J</kbd>/
              <kbd className="px-1 py-0.5 bg-muted rounded">K</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">M</kbd> Medical
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">N</kbd> Not
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> Confirm
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">D</kbd> Dismiss
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">X</kbd> Select
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
