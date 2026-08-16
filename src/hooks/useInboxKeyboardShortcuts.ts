import { useEffect, useCallback } from "react";
import type { InboxItem } from "./useInboxItems";

interface UseInboxKeyboardShortcutsOptions {
  items: InboxItem[];
  focusedIndex: number;
  selectedIds: Set<string>;
  expanded: boolean;
  onFocusChange: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onActOnItem: (item: InboxItem, action: string) => void;
  onDismissItem: (item: InboxItem) => void;
  onBatchAct: (items: InboxItem[], action: string) => void;
  onBatchDismiss: (items: InboxItem[]) => void;
  onToggleExpand: () => void;
}

export function useInboxKeyboardShortcuts({
  items,
  focusedIndex,
  selectedIds,
  expanded,
  onFocusChange,
  onToggleSelect,
  onSelectAll,
  onActOnItem,
  onDismissItem,
  onBatchAct,
  onBatchDismiss,
  onToggleExpand,
}: UseInboxKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle shortcuts when a dialog/modal is open or user is in an input
      if (document.querySelector("[role='dialog']")) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (!expanded) {
        // Only allow toggle expand when collapsed
        if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          onToggleExpand();
        }
        return;
      }

      if (items.length === 0) return;

      const focused = items[focusedIndex];

      switch (e.key) {
        case "j":
        case "J":
          e.preventDefault();
          onFocusChange(Math.min(focusedIndex + 1, items.length - 1));
          break;

        case "k":
        case "K":
          e.preventDefault();
          onFocusChange(Math.max(focusedIndex - 1, 0));
          break;

        case "x":
        case "X":
        case " ":
          e.preventDefault();
          if (focused && !focused.isVirtual) {
            onToggleSelect(focused.id);
          }
          break;

        case "a":
        case "A":
          e.preventDefault();
          onSelectAll();
          break;

        case "Enter":
          e.preventDefault();
          if (e.shiftKey) {
            // Batch confirm all selected
            const selected = items.filter((i) => selectedIds.has(i.id));
            if (selected.length > 0) {
              onBatchAct(selected, "medical");
            }
          } else if (focused) {
            // Confirm suggested action on focused item
            if (focused.item_type === "review_transaction") {
              onActOnItem(focused, "medical");
            }
          }
          break;

        case "d":
        case "D":
          e.preventDefault();
          if (e.shiftKey) {
            // Batch dismiss all selected
            const selected = items.filter((i) => selectedIds.has(i.id));
            if (selected.length > 0) {
              onBatchDismiss(selected);
            }
          } else if (focused && !focused.isVirtual) {
            onDismissItem(focused);
          }
          break;

        case "m":
        case "M":
          e.preventDefault();
          if (focused?.item_type === "review_transaction") {
            onActOnItem(focused, "medical");
          }
          break;

        case "n":
        case "N":
          e.preventDefault();
          if (focused?.item_type === "review_transaction") {
            onActOnItem(focused, "not_medical");
          }
          break;
      }
    },
    [
      items,
      focusedIndex,
      selectedIds,
      expanded,
      onFocusChange,
      onToggleSelect,
      onSelectAll,
      onActOnItem,
      onDismissItem,
      onBatchAct,
      onBatchDismiss,
      onToggleExpand,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
