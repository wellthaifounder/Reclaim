import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Eye,
  X,
  Image as ImageIcon,
  Pencil,
  Check,
} from "lucide-react";
import { toast } from "sonner";

interface Receipt {
  id: string;
  file_path: string;
  file_type: string;
  document_type: string;
  description?: string | null;
  display_order: number;
  uploaded_at: string;
}

interface ReceiptGalleryProps {
  expenseId: string;
  receipts: Receipt[];
  onReceiptDeleted?: () => void;
  onReceiptUpdated?: () => void;
}

const DOCUMENT_TYPE_LABELS = {
  invoice: "Bill",
  bill: "Bill",
  payment_receipt: "Payment Receipt",
  eob: "EOB",
  itemized_statement: "Itemized Statement",
  prescription_label: "Prescription Label",
  receipt: "Receipt",
  other: "Other",
};

const DOCUMENT_TYPE_COLORS = {
  invoice: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  bill: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  payment_receipt:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  eob: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  itemized_statement:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  prescription_label:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  receipt: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  other:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

export function ReceiptGallery({
  expenseId: _expenseId,
  receipts,
  onReceiptDeleted,
  onReceiptUpdated,
}: ReceiptGalleryProps) {
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [viewUrl, setViewUrl] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleView = async (receipt: Receipt) => {
    try {
      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(receipt.file_path, 3600);

      if (error) throw error;

      setViewUrl(data.signedUrl);
      setSelectedReceipt(receipt);
    } catch (error) {
      logError("Error viewing receipt", error);
      toast.error("Error", {
        description: "Failed to load receipt for viewing",
      });
    }
  };

  const handleDownload = async (receipt: Receipt) => {
    try {
      const { data, error } = await supabase.storage
        .from("receipts")
        .download(receipt.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        receipt.description || receipt.file_path.split("/").pop() || "receipt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Success", {
        description: "Receipt downloaded successfully",
      });
    } catch (error) {
      logError("Error downloading receipt", error);
      toast.error("Error", {
        description: "Failed to download receipt",
      });
    }
  };

  const handleDelete = async (receiptId: string) => {
    try {
      const { error } = await supabase
        .from("receipts")
        .delete()
        .eq("id", receiptId);

      if (error) throw error;

      toast.success("Success", { description: "Receipt deleted successfully" });
      onReceiptDeleted?.();
    } catch (error) {
      logError("Error deleting receipt", error);
      toast.error("Error", {
        description: "Failed to delete receipt",
      });
    }
  };

  const startEditing = (receipt: Receipt) => {
    setEditingId(receipt.id);
    setEditingName(receipt.description ?? "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveName = async (receiptId: string) => {
    setSavingId(receiptId);
    try {
      const { error } = await supabase
        .from("receipts")
        .update({ description: editingName.trim() || null })
        .eq("id", receiptId);

      if (error) throw error;

      toast.success("Saved", { description: "Document name updated" });
      setEditingId(null);
      setEditingName("");
      onReceiptUpdated?.();
    } catch (error) {
      logError("Error updating receipt name", error);
      toast.error("Error", {
        description: "Failed to update document name",
      });
    } finally {
      setSavingId(null);
    }
  };

  const sortedReceipts = [...receipts].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );

  if (receipts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="mx-auto h-12 w-12 mb-2 opacity-50" />
        <p>No receipts uploaded</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {sortedReceipts.map((receipt) => {
          const typeLabel =
            DOCUMENT_TYPE_LABELS[
              receipt.document_type as keyof typeof DOCUMENT_TYPE_LABELS
            ] ?? receipt.document_type;
          const typeColor =
            DOCUMENT_TYPE_COLORS[
              receipt.document_type as keyof typeof DOCUMENT_TYPE_COLORS
            ] ?? DOCUMENT_TYPE_COLORS.other;
          const isEditing = editingId === receipt.id;
          const isSaving = savingId === receipt.id;

          return (
            <div
              key={receipt.id}
              className="flex items-center gap-3 border rounded-lg p-3 bg-card hover:shadow-sm transition-shadow"
            >
              {/* File icon */}
              <div className="shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                {receipt.file_type.startsWith("image/") ? (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <FileText className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              {/* Name + type */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      className="h-8 text-sm"
                      placeholder="Document name…"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(receipt.id);
                        if (e.key === "Escape") cancelEditing();
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-primary"
                      disabled={isSaving}
                      onClick={() => saveName(receipt.id)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={cancelEditing}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 group/name">
                    <span className="text-sm font-medium truncate">
                      {receipt.description || typeLabel}
                    </span>
                    <button
                      onClick={() => startEditing(receipt)}
                      className="opacity-0 group-hover/name:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={`text-[10px] px-1.5 py-0 ${typeColor}`}>
                    {typeLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Uploaded{" "}
                    {new Date(receipt.uploaded_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleView(receipt)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(receipt)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(receipt.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!selectedReceipt}
        onOpenChange={() => setSelectedReceipt(null)}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedReceipt?.description ||
                (selectedReceipt &&
                  DOCUMENT_TYPE_LABELS[
                    selectedReceipt.document_type as keyof typeof DOCUMENT_TYPE_LABELS
                  ])}
            </DialogTitle>
          </DialogHeader>
          {selectedReceipt && viewUrl && (
            <div className="mt-4">
              {selectedReceipt.file_type.startsWith("image/") ? (
                <img
                  src={viewUrl}
                  alt="Receipt"
                  className="w-full rounded-lg"
                />
              ) : (
                <iframe
                  src={viewUrl}
                  className="w-full h-[70vh] rounded-lg"
                  title="Receipt viewer"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
