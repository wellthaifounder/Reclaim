import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { logError } from "@/utils/errorHandler";
import { FileText, Calendar } from "lucide-react";
import { format } from "date-fns";

interface AttachDocumentDialogProps {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttached: () => void;
}

interface UnattachedReceipt {
  id: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
  file_type: string;
}

export const AttachDocumentDialog = ({
  invoiceId,
  open,
  onOpenChange,
  onAttached,
}: AttachDocumentDialogProps) => {
  const [receipts, setReceipts] = useState<UnattachedReceipt[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (open) {
      loadUnattachedReceipts();
    }
  }, [open]);

  const loadUnattachedReceipts = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("receipts")
        .select("id, document_type, description, uploaded_at, file_type")
        .eq("user_id", user.id)
        .is("invoice_id", null)
        .is("payment_transaction_id", null)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      setReceipts(data || []);
    } catch (error) {
      logError("Error loading unattached receipts", error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const handleAttach = async () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one document");
      return;
    }

    try {
      setAttaching(true);
      const { error } = await supabase
        .from("receipts")
        .update({ invoice_id: invoiceId })
        .in("id", selectedIds);

      if (error) throw error;

      toast.success(`${selectedIds.length} document(s) attached successfully`);
      onAttached();
      onOpenChange(false);
    } catch (error) {
      logError("Error attaching documents", error);
      toast.error("Failed to attach documents");
    } finally {
      setAttaching(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Attach Existing Documents</DialogTitle>
          <DialogDescription>
            Select documents from your library to attach to this bill
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm text-muted-foreground">
                Loading documents...
              </p>
            </div>
          ) : receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No unattached documents available</p>
              <p className="text-sm mt-1">
                Upload documents first or check the Documents center
              </p>
            </div>
          ) : (
            receipts.map((receipt) => (
              <div
                key={receipt.id}
                className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                onClick={() => toggleSelection(receipt.id)}
              >
                <Checkbox
                  checked={selectedIds.includes(receipt.id)}
                  onCheckedChange={() => toggleSelection(receipt.id)}
                />
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {receipt.document_type?.replace(/_/g, " ") ?? "document"}
                    </Badge>
                  </div>
                  {receipt.description && (
                    <p className="text-sm mt-1">{receipt.description}</p>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(receipt.uploaded_at), "MMM d, yyyy")}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAttach}
            disabled={attaching || selectedIds.length === 0}
          >
            {attaching
              ? "Attaching..."
              : `Attach ${selectedIds.length > 0 ? `(${selectedIds.length})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
