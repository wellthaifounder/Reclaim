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
import {
  DOCUMENT_TYPES,
  DEFAULT_DOCUMENT_TYPE,
  documentTypeLabel,
  documentTypePickerLabel,
  isPickableDocumentType,
  normalizeDocumentType,
} from "@/lib/documentTypes";

interface EditDocumentDialogProps {
  receipt: {
    id: string;
    file_name: string | null;
    document_type: string | null;
    description: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export const EditDocumentDialog = ({
  receipt,
  open,
  onOpenChange,
  onSaved,
}: EditDocumentDialogProps) => {
  const [documentType, setDocumentType] = useState(
    normalizeDocumentType(receipt.document_type ?? DEFAULT_DOCUMENT_TYPE),
  );

  // A document may already carry a type no picker offers -- the legacy 'bill'
  // spelling, or a letter of medical necessity. Show it as its own option
  // rather than letting the box render empty: a blank type box reads as "no
  // type set", and whatever the person picked next overwrote the real one.
  const options = isPickableDocumentType(documentType)
    ? DOCUMENT_TYPES
    : [
        ...DOCUMENT_TYPES,
        { value: documentType, label: documentTypeLabel(documentType) },
      ];

  // Attaching a letter of medical necessity is what clears a conditionally
  // eligible expense, and trg_receipts_lmn fires on INSERT and DELETE only --
  // so retyping one here would drop the evidence without anything recomputing
  // the eligibility it was holding up. Detach and re-upload instead.
  const typeLocked = documentType === "letter_of_medical_necessity";
  const [fileName, setFileName] = useState(receipt.file_name || "");
  const [description, setDescription] = useState(receipt.description || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from("receipts")
        .update({
          document_type: documentType,
          // Renaming changes the title only. file_path is untouched on
          // purpose: it is what every signed URL, download and claim packet
          // resolves, and moving stored objects to follow a rename is how a
          // record comes to cite a file that is no longer where it says.
          file_name: fileName.trim() || null,
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
            Rename it, change its type, or add a description
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file-name">File name</Label>
            <Input
              id="document-file-name"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g. Averie-itemized-statement.pdf"
            />
            <p className="text-xs text-muted-foreground">
              Only what you see here changes. The stored file itself stays where
              it is, so anything already pointing at it keeps working.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Document type</Label>
            <Select
              value={documentType}
              onValueChange={setDocumentType}
              disabled={typeLocked}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {documentTypePickerLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeLocked && (
              <p className="text-xs text-muted-foreground">
                A letter of medical necessity is what makes its expense
                eligible, so its type is fixed. Remove the document from the
                expense if it was filed by mistake.
              </p>
            )}
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
