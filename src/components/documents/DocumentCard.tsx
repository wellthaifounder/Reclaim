import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Eye,
  Download,
  Edit,
  Trash2,
  FileText,
  Link2,
  FolderOpen,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { logError } from "@/utils/errorHandler";
import { format } from "date-fns";

interface DocumentCardProps {
  receipt: {
    id: string;
    file_path: string;
    file_type: string;
    document_type: string | null;
    description: string | null;
    uploaded_at: string;
    invoice_id: string | null;
    payment_transaction_id: string | null;
    collection_id?: string | null;
    collections?: {
      id: string;
      title: string;
      color: string | null;
    } | null;
  };
  onEdit: () => void;
  onDelete: (id: string) => void;
  onLinkToCollection?: () => void;
}

export const DocumentCard = ({
  receipt,
  onEdit,
  onDelete,
  onLinkToCollection,
}: DocumentCardProps) => {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleView = async () => {
    try {
      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(receipt.file_path, 3600);

      if (error) throw error;
      setViewUrl(data.signedUrl);
      setShowPreview(true);
    } catch (error) {
      logError("Error viewing document", error);
      toast.error("Failed to load document");
    }
  };

  const handleDownload = async () => {
    try {
      const { data, error } = await supabase.storage
        .from("receipts")
        .download(receipt.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = receipt.file_path.split("/").pop() || "document";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Document downloaded");
    } catch (error) {
      logError("Error downloading document", error);
      toast.error("Failed to download document");
    }
  };

  const isImage = receipt.file_type.startsWith("image/");
  const isAttached = receipt.invoice_id || receipt.payment_transaction_id;
  const hasCollection = receipt.collection_id && receipt.collections;
  const isOrphaned = !isAttached && !hasCollection;

  return (
    <>
      <Card className="overflow-hidden hover:shadow-lg transition-shadow">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">
                  {receipt.document_type?.replace(/_/g, " ") ?? "document"}
                </Badge>
              </div>
              {receipt.description && (
                <p className="text-sm text-foreground line-clamp-2 mb-2">
                  {receipt.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {format(new Date(receipt.uploaded_at), "MMM d, yyyy")}
              </p>
            </div>
          </div>

          {/* Care-event label. Was a link to /collections/:id until
              2026-08-20, when that surface was retired; the label stays
              because documents filed under an old care event should still
              say so, but there is no longer a page to open. */}
          {hasCollection && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              {receipt.collections!.color && (
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: receipt.collections!.color }}
                />
              )}
              <FolderOpen className="h-3 w-3" />
              <span className="truncate">{receipt.collections!.title}</span>
            </div>
          )}

          {/* Bill/Payment Attachment */}
          {isAttached && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              <Link2 className="h-3 w-3" />
              <span>Attached to {receipt.invoice_id ? "bill" : "payment"}</span>
            </div>
          )}

          {/* Orphaned Warning */}
          {isOrphaned && onLinkToCollection && (
            <Button
              variant="outline"
              size="sm"
              onClick={onLinkToCollection}
              className="w-full text-xs gap-1 border-dashed border-amber-500/50 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            >
              <Unlink className="h-3 w-3" />
              Not linked to any collection
            </Button>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleView}
              className="flex-1"
            >
              <Eye className="h-3 w-3 mr-1" />
              View
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(receipt.id)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          {viewUrl &&
            (isImage ? (
              <img
                src={viewUrl}
                alt="Document preview"
                className="w-full h-auto"
              />
            ) : (
              <iframe
                src={viewUrl}
                className="w-full h-[80vh]"
                title="Document preview"
              />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
};
