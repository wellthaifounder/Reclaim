import { useState, useEffect } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { CreateLabelDialog } from "./CreateLabelDialog";
import { LabelBadge } from "./LabelBadge";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

interface LabelSelectorProps {
  resourceId: string;
  resourceType: "invoice" | "payment" | "receipt";
  selectedLabels: any[];
  onLabelsChange: (labels: any[]) => void;
}

export const LabelSelector = ({
  resourceId,
  resourceType,
  selectedLabels,
  onLabelsChange,
}: LabelSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [availableLabels, setAvailableLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLabels();
    fetchResourceLabels();
  }, [resourceId]);

  const fetchLabels = async () => {
    try {
      const { data, error } = await supabase
        .from("labels")
        .select("*")
        .order("name");

      if (error) throw error;
      setAvailableLabels(data || []);
    } catch (error) {
      logError("Error fetching labels", error);
    }
  };

  const fetchResourceLabels = async () => {
    try {
      const tableMap = {
        invoice: { table: "invoice_labels", column: "invoice_id" },
        payment: { table: "payment_labels", column: "payment_transaction_id" },
        receipt: { table: "receipt_labels", column: "receipt_id" },
      } as const;

      const { table, column } = tableMap[resourceType];

      const { data, error } = await supabase
        .from(table)
        .select(
          `
          label_id,
          labels (*)
        `,
        )
        .eq(column, resourceId);

      if (error) throw error;
      const labels =
        data?.map((item: any) => item.labels).filter(Boolean) || [];
      onLabelsChange(labels);
    } catch (error) {
      logError("Error fetching resource labels", error);
    }
  };

  const toggleLabel = async (label: any) => {
    setLoading(true);
    try {
      const isSelected = selectedLabels.some((l) => l.id === label.id);

      const tableMap = {
        invoice: { table: "invoice_labels", column: "invoice_id" },
        payment: { table: "payment_labels", column: "payment_transaction_id" },
        receipt: { table: "receipt_labels", column: "receipt_id" },
      } as const;

      const { table, column } = tableMap[resourceType];

      if (isSelected) {
        // Remove label
        const { error } = await supabase
          .from(table)
          .delete()
          .eq(column, resourceId)
          .eq("label_id", label.id);

        if (error) throw error;

        onLabelsChange(selectedLabels.filter((l) => l.id !== label.id));
        toast.success(`Removed label "${label.name}"`);
      } else {
        // Add label. Branched per resource type rather than using a computed
        // `[column]` key: that widens the literal to an index signature, which
        // matches none of the three join-table row shapes.
        const insert =
          resourceType === "invoice"
            ? supabase
                .from("invoice_labels")
                .insert({ invoice_id: resourceId, label_id: label.id })
            : resourceType === "payment"
              ? supabase.from("payment_labels").insert({
                  payment_transaction_id: resourceId,
                  label_id: label.id,
                })
              : supabase
                  .from("receipt_labels")
                  .insert({ receipt_id: resourceId, label_id: label.id });

        const { error } = await insert;

        if (error) throw error;

        onLabelsChange([...selectedLabels, label]);
        toast.success(`Added label "${label.name}"`);
      }
    } catch (error) {
      logError("Error toggling label", error);
      toast.error("Failed to update label");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLabel = (newLabel: any) => {
    setAvailableLabels([...availableLabels, newLabel]);
    toggleLabel(newLabel);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selectedLabels.map((label) => (
          <LabelBadge
            key={label.id}
            name={label.name}
            color={label.color}
            onRemove={() => toggleLabel(label)}
          />
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Tag className="h-4 w-4 mr-2" />
            Manage Labels
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search labels..." />
            <CommandEmpty>
              <div className="py-6 text-center text-sm">
                <p className="mb-2">No labels found</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    setCreateDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Label
                </Button>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {availableLabels.map((label) => {
                const isSelected = selectedLabels.some(
                  (l) => l.id === label.id,
                );
                return (
                  <CommandItem
                    key={label.id}
                    onSelect={() => toggleLabel(label)}
                    disabled={loading}
                  >
                    <div
                      className="mr-2 h-4 w-4 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1">{label.name}</span>
                    {isSelected && <Check className="h-4 w-4" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  setCreateDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Label
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <CreateLabelDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreateLabel}
      />
    </div>
  );
};
