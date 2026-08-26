import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

interface EditDocumentDialogProps {
  receipt: {
    id: string;
    document_type: string | null;
    description: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const DOCUMENT_TYPES = [
  { value: "receipt", label: "Receipt" },
  { value: "invoice", label: "Bill" },
  { value: "eob", label: "Explanation of Benefits (EOB)" },
  { value: "payment_confirmation", label: "Payment Confirmation" },
  { value: "medical_record", label: "Medical Record" },
];

export const EditDocumentDialog = ({
  receipt,
  open,
  onOpenChange,
  onSaved,
}: EditDocumentDialogProps) => {
  const [documentType, setDocumentType] = useState(
    receipt.document_type ?? "receipt",
  );
  const [description, setDescription] = useState(receipt.description || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from("receipts")
        .update({
          document_type: documentType,
          description: description || null,
        })
        .eq("id", receipt.id);

      if (error) throw error;

      toast.success("Document updated successfully");
      onSaved();
    } catch (error) {
      logError("Error updating document", error);
      toast.error("Failed to update document");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
          <DialogDescription>
            Update the document type and description
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
