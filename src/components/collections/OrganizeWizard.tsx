import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
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

interface OrganizeWizardProps {
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

export function OrganizeWizard({
  open,
  onOpenChange,
  onComplete,
}: OrganizeWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("select");
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [newCollectionTitle, setNewCollectionTitle] = useState("");
  const [newCollectionDescription, setNewCollectionDescription] = useState("");
  const [createdCount, setCreatedCount] = useState(0);

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

  // Create collection mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create the collection
      const { data: collection, error: createError } = await supabase
        .from("collections")
        .insert({
          user_id: user.id,
          title: newCollectionTitle,
          description: newCollectionDescription || null,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Link selected invoices to the collection
      if (selectedInvoices.length > 0) {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({ collection_id: collection.id })
          .in("id", selectedInvoices);

        if (updateError) throw updateError;
      }

      return collection;
    },
    onSuccess: () => {
      setCreatedCount((c) => c + 1);
      setSelectedInvoices([]);
      setNewCollectionTitle("");
      setNewCollectionDescription("");
      queryClient.invalidateQueries({ queryKey: ["unorganized-invoices"] });
      toast.success("Event created and bills linked!");
    },
    onError: (error) => {
      toast.error("Failed to create care event");
      logError("Failed to create care event", error);
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

  const handleCreate = () => {
    if (!newCollectionTitle.trim()) {
      toast.error("Please enter a care event title");
      return;
    }
    createMutation.mutate();
  };

  const handleComplete = () => {
    onComplete();
    setStep("select");
    setSelectedInvoices([]);
    setCreatedCount(0);
  };

  // Auto-fill title from selection
  const autoFillFromSelection = () => {
    if (selectedInvoices.length > 0 && !newCollectionTitle) {
      const firstInvoice = invoices?.find((i) =>
        selectedInvoices.includes(i.id),
      );
      if (firstInvoice) {
        const date = format(new Date(firstInvoice.date), "MMM yyyy");
        setNewCollectionTitle(`${firstInvoice.vendor} - ${date}`);
      }
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Organize Your Bills</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {step === "select" && "Select bills to group into an event"}
          {step === "organize" &&
            "Create a new event and link the selected bills"}
          {step === "complete" && "Great job organizing your bills!"}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

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
                              onCheckedChange={() => toggleInvoice(invoice.id)}
                            />
                            <div className="flex-1 flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                {format(new Date(invoice.date), "MMM d, yyyy")}
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
                Creating care event with{" "}
                <span className="font-semibold">
                  {selectedInvoices.length} bill
                  {selectedInvoices.length > 1 ? "s" : ""}
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="collection-title">Event Title *</Label>
              <Input
                id="collection-title"
                placeholder='e.g., "Mom - Knee Surgery" or "2026 Dental"'
                value={newCollectionTitle}
                onChange={(e) => setNewCollectionTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="collection-description">
                Description (Optional)
              </Label>
              <Textarea
                id="collection-description"
                placeholder="Add any notes about this care event..."
                value={newCollectionDescription}
                onChange={(e) => setNewCollectionDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <Button variant="ghost" onClick={() => setStep("select")}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                onClick={handleCreate}
                disabled={
                  createMutation.isPending || !newCollectionTitle.trim()
                }
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Plus className="h-4 w-4 mr-2" />
                Create Care Event
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
              {createdCount} Care Event{createdCount > 1 ? "s" : ""} Created!
            </h3>
            <p className="text-muted-foreground">
              Your bills are now organized into care events for easier tracking.
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
    </ResponsiveDialog>
  );
}
