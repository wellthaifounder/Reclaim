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
  };
  onEdit: () => void;
  onDelete: (id: string) => void;
}

export const DocumentCard = ({
  receipt,
  onEdit,
  onDelete,
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
  const isAttached = !!receipt.invoice_id;

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

          {/* Attached / on file (2026-08-21).

              This used to be three states: attached to a bill, attached to a
              payment, or an amber "not linked to any collection" warning with
              a button to file it under a care event. Payments and care events
              are both gone, and the warning was wrong anyway -- a document
              that isn't attached yet is a perfectly good document. It gets
              picked up from the substantiate dialog, where the expense it
              belongs to is on screen, and one document can serve several
              expenses. So an unattached document is now stated, not scolded. */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            {isAttached ? (
              <>
                <Link2 className="h-3 w-3" />
                <span>Attached to an expense</span>
              </>
            ) : (
              <>
                <FolderOpen className="h-3 w-3" />
                <span>On file — not attached yet</span>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleView}
              className="flex-1 h-11"
            >
              <Eye className="h-3 w-3 mr-1" />
              View
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={handleDownload}
              aria-label="Download document"
            >
              <Download className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={onEdit}
              aria-label="Edit document"
            >
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 text-destructive hover:text-destructive"
              onClick={() => onDelete(receipt.id)}
              aria-label="Delete document"
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
