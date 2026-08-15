import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import {
  Loader2,
  Plus,
  ArrowRight,
  CheckCircle2,
  Building2,
  Calendar,
  DollarSign,
} from "lucide-react";
import { format } from "date-fns";

interface MigrationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  category: string;
}

type Step = "select" | "organize" | "complete";

const EVENT_TYPES = [
  { value: "surgery", label: "Surgery" },
  { value: "office_visit", label: "Office Visit" },
  { value: "emergency", label: "Emergency" },
  { value: "ongoing_treatment", label: "Ongoing Treatment" },
  { value: "lab_test", label: "Lab Test" },
  { value: "imaging", label: "Imaging" },
  { value: "physical_therapy", label: "Physical Therapy" },
  { value: "dental", label: "Dental" },
  { value: "vision", label: "Vision" },
  { value: "prescription", label: "Prescription" },
  { value: "other", label: "Other" },
];

export function MigrationWizard({
  open,
  onOpenChange,
  onComplete,
}: MigrationWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("select");
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventType, setNewEventType] = useState("other");
  const [newEventProvider, setNewEventProvider] = useState("");
  const [createdEventsCount, setCreatedEventsCount] = useState(0);

  // Fetch unorganized invoices
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["unorganized-invoices"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("invoices")
        .select("id, vendor, amount, date, category")
        .eq("user_id", user.id)
        .is("collection_id", null)
        .order("date", { ascending: false });

      if (error) throw error;
      return data as Invoice[];
    },
    enabled: open,
  });

  // Group invoices by vendor for easier selection
  const invoicesByVendor =
    invoices?.reduce(
      (acc, inv) => {
        if (!acc[inv.vendor]) acc[inv.vendor] = [];
        acc[inv.vendor].push(inv);
        return acc;
      },
      {} as Record<string, Invoice[]>,
    ) || {};

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create the event
      const { data: event, error: eventError } = await supabase
        .from("collections")
        .insert({
          user_id: user.id,
          title: newEventTitle,
          event_type: newEventType,
          primary_provider: newEventProvider || null,
          event_date:
            selectedInvoices.length > 0
              ? invoices?.find((i) => selectedInvoices.includes(i.id))?.date
              : null,
        })
        .select()
        .single();

      if (eventError) throw eventError;

      // Link selected invoices to the event
      if (selectedInvoices.length > 0) {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({ collection_id: event.id })
          .in("id", selectedInvoices);

        if (updateError) throw updateError;
      }

      return event;
    },
    onSuccess: () => {
      setCreatedEventsCount((c) => c + 1);
      setSelectedInvoices([]);
      setNewEventTitle("");
      setNewEventType("other");
      setNewEventProvider("");
      queryClient.invalidateQueries({ queryKey: ["unorganized-invoices"] });
      toast.success("Event created and invoices linked!");
    },
    onError: (error) => {
      toast.error("Failed to create event");
      logError("Failed to create event", error);
    },
  });

  const handleSelectAll = (vendor: string) => {
    const vendorInvoiceIds = invoicesByVendor[vendor].map((i) => i.id);
    const allSelected = vendorInvoiceIds.every((id) =>
      selectedInvoices.includes(id),
    );

    if (allSelected) {
      setSelectedInvoices(
        selectedInvoices.filter((id) => !vendorInvoiceIds.includes(id)),
      );
    } else {
      setSelectedInvoices([
        ...new Set([...selectedInvoices, ...vendorInvoiceIds]),
      ]);
    }
  };

  const toggleInvoice = (id: string) => {
    if (selectedInvoices.includes(id)) {
      setSelectedInvoices(selectedInvoices.filter((i) => i !== id));
    } else {
      setSelectedInvoices([...selectedInvoices, id]);
    }
  };

  const handleCreateEvent = () => {
    if (!newEventTitle.trim()) {
      toast.error("Please enter an event title");
      return;
    }
    createEventMutation.mutate();
  };

  const handleComplete = () => {
    onComplete();
    setStep("select");
    setSelectedInvoices([]);
    setCreatedEventsCount(0);
  };

  // Auto-fill event details from selection
  const autoFillFromSelection = () => {
    if (selectedInvoices.length > 0) {
      const firstInvoice = invoices?.find((i) =>
        selectedInvoices.includes(i.id),
      );
      if (firstInvoice) {
        if (!newEventProvider) setNewEventProvider(firstInvoice.vendor);
        if (!newEventTitle) {
          const date = format(new Date(firstInvoice.date), "MMM yyyy");
          setNewEventTitle(`${firstInvoice.vendor} - ${date}`);
        }
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Organize Your Bills</DialogTitle>
          <DialogDescription>
            {step === "select" && "Select bills to group into a medical event"}
            {step === "organize" &&
              "Create a new event and link the selected bills"}
            {step === "complete" && "Great job organizing your bills!"}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <>
            <ScrollArea className="flex-1 max-h-[400px] pr-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : Object.keys(invoicesByVendor).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4" />
                  <p>All your bills are organized!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(invoicesByVendor).map(
                    ([vendor, vendorInvoices]) => (
                      <div key={vendor} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{vendor}</span>
                            <Badge variant="secondary" className="text-xs">
                              {vendorInvoices.length} bill
                              {vendorInvoices.length > 1 ? "s" : ""}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectAll(vendor)}
                          >
                            {vendorInvoices.every((i) =>
                              selectedInvoices.includes(i.id),
                            )
                              ? "Deselect All"
                              : "Select All"}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {vendorInvoices.map((invoice) => (
                            <div
                              key={invoice.id}
                              className="flex items-center gap-3 p-2 rounded hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={selectedInvoices.includes(invoice.id)}
                                onCheckedChange={() =>
                                  toggleInvoice(invoice.id)
                                }
                              />
                              <div className="flex-1 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm">
                                  <Calendar className="h-3 w-3 text-muted-foreground" />
                                  {format(
                                    new Date(invoice.date),
                                    "MMM d, yyyy",
                                  )}
                                  <Badge variant="outline" className="text-xs">
                                    {invoice.category}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-1 text-sm font-medium">
                                  <DollarSign className="h-3 w-3" />
                                  {invoice.amount.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-between pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                {selectedInvoices.length} bill
                {selectedInvoices.length !== 1 ? "s" : ""} selected
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Skip for Now
                </Button>
                <Button
                  onClick={() => {
                    autoFillFromSelection();
                    setStep("organize");
                  }}
                  disabled={selectedInvoices.length === 0}
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "organize" && (
          <>
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">
                  Creating event with{" "}
                  <span className="font-semibold">
                    {selectedInvoices.length} bill
                    {selectedInvoices.length > 1 ? "s" : ""}
                  </span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-title">Event Title *</Label>
                <Input
                  id="event-title"
                  placeholder="e.g., Shoulder Surgery - Jan 2026"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="event-type">Event Type</Label>
                  <Select value={newEventType} onValueChange={setNewEventType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-provider">Primary Provider</Label>
                  <Input
                    id="event-provider"
                    placeholder="e.g., City Hospital"
                    value={newEventProvider}
                    onChange={(e) => setNewEventProvider(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="ghost" onClick={() => setStep("select")}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateEvent}
                  disabled={
                    createEventMutation.isPending || !newEventTitle.trim()
                  }
                >
                  {createEventMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  <Plus className="h-4 w-4 mr-2" />
                  Create Event
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "complete" && (
          <>
            <div className="text-center py-8">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                {createdEventsCount} Event{createdEventsCount > 1 ? "s" : ""}{" "}
                Created!
              </h3>
              <p className="text-muted-foreground">
                Your bills are now organized into medical events for easier
                tracking.
              </p>
            </div>

            <div className="flex justify-center gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setStep("select")}>
                Organize More
              </Button>
              <Button onClick={handleComplete}>Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
