import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import { useRecomputeTiming } from "@/hooks/useHSAEligibility";

interface SetHSADateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetHSADateDialog({
  open,
  onOpenChange,
  onSuccess,
}: SetHSADateDialogProps) {
  const [date, setDate] = useState<Date>();
  const [saving, setSaving] = useState(false);
  const recomputeTiming = useRecomputeTiming();

  const handleSave = async () => {
    if (!date) {
      toast.error("Please select a date");
      return;
    }

    // Validate that date is not in the future
    if (date > new Date()) {
      toast.error("HSA opened date cannot be in the future");
      return;
    }

    try {
      setSaving(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const hsaDateString = format(date, "yyyy-MM-dd");

      // Update or create profile with HSA opened date
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, hsa_opened_date: hsaDateString },
          { onConflict: "id" },
        );

      if (profileError) throw profileError;

      // Workstream D2: recompute the establishment-date cliff in the
      // database, in both directions. This replaced two hand-written bulk
      // updates that were each filtered on `is_hsa_eligible = true` -- a
      // generated column meaning eligibility_state is 'eligible'. Expenses
      // default to 'unknown', so the filter matched almost nothing and the
      // cliff had effectively stopped firing.
      const { blocked, restored } = await recomputeTiming.mutateAsync();

      // Restoring is the surprising outcome and gets said first: it is what
      // happens when someone corrects a year they mistyped, and until now
      // there was no way back from that mistake.
      toast.success(
        restored > 0
          ? `HSA date saved. ${restored} expense${restored === 1 ? "" : "s"} ${restored === 1 ? "is" : "are"} claimable again.`
          : blocked > 0
            ? `HSA date saved. ${blocked} expense${blocked === 1 ? "" : "s"} predate${blocked === 1 ? "s" : ""} your HSA and can't be reimbursed.`
            : "HSA date saved.",
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      logError("Error saving HSA date", error);
      toast.error("Failed to save HSA date");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          When did you open your HSA?
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          We'll use this to determine which expenses you can reimburse. You can
          only claim expenses that occurred after your HSA was opened.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <ResponsiveDialogBody className="px-4 py-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !date && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "PPP") : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              initialFocus
              className="pointer-events-auto"
              disabled={(date) => date > new Date()}
            />
          </PopoverContent>
        </Popover>
      </ResponsiveDialogBody>

      <ResponsiveDialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!date || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
