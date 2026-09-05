import { useState, useEffect, useCallback } from "react";
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

interface PickableReceipt {
  id: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
  file_type: string;
  /** How many OTHER expenses this document is already attached to. A
   * document can substantiate more than one expense (a hospital bill paid in
   * instalments, say), so this is a hint, not an exclusion. */
  attachedElsewhereCount: number;
}

export const AttachDocumentDialog = ({
  invoiceId,
  open,
  onOpenChange,
  onAttached,
}: AttachDocumentDialogProps) => {
  const [receipts, setReceipts] = useState<PickableReceipt[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const loadPickableReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Every document the user has, and separately, which of those are
      // already attached to this expense (excluded -- attaching twice is a
      // no-op) or to some other expense (kept, and counted: a document can
      // substantiate more than one expense, so being attached elsewhere is
      // not a reason to hide it here).
      const [{ data: allReceipts, error: receiptsError }, { data: links }] =
        await Promise.all([
          supabase
            .from("receipts")
            .select("id, document_type, description, uploaded_at, file_type")
            .eq("user_id", user.id)
            .order("uploaded_at", { ascending: false }),
          supabase
            .from("receipt_invoices")
            .select("receipt_id, invoice_id")
            .eq("user_id", user.id),
        ]);

      if (receiptsError) throw receiptsError;

      const attachedHere = new Set(
        (links ?? [])
          .filter((l) => l.invoice_id === invoiceId)
          .map((l) => l.receipt_id),
      );
      const elsewhereCounts = new Map<string, number>();
      for (const l of links ?? []) {
        if (l.invoice_id === invoiceId) continue;
        elsewhereCounts.set(
          l.receipt_id,
          (elsewhereCounts.get(l.receipt_id) ?? 0) + 1,
        );
      }

      const pickable = (allReceipts ?? [])
        .filter((r) => !attachedHere.has(r.id))
        .map((r) => ({
          ...r,
          attachedElsewhereCount: elsewhereCounts.get(r.id) ?? 0,
        }));
      setReceipts(pickable);
    } catch (error) {
      logError("Error loading documents to attach", error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (open) {
      void loadPickableReceipts();
    }
  }, [open, loadPickableReceipts]);

  const handleAttach = async () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one document");
      return;
    }

    try {
      setAttaching(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("receipt_invoices").upsert(
        selectedIds.map((receiptId) => ({
          receipt_id: receiptId,
          invoice_id: invoiceId,
          user_id: user.id,
        })),
        { onConflict: "receipt_id,invoice_id", ignoreDuplicates: true },
      );

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
              <p>No documents available to attach</p>
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
                  onClick={(e) => e.stopPropagation()}
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
                  {receipt.attachedElsewhereCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Already attached to{" "}
                      {receipt.attachedElsewhereCount === 1
                        ? "1 other expense"
                        : `${receipt.attachedElsewhereCount} other expenses`}
                    </p>
                  )}
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
