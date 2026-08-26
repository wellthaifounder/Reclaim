import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, FileText, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { validateFiles } from "@/utils/fileValidation";

interface FileWithMetadata {
  file: File;
  documentType: string;
  description: string;
  id: string;
}

interface MultiFileUploadProps {
  onFilesChange: (files: FileWithMetadata[]) => void;
  disabled?: boolean;
}

const DOCUMENT_TYPES = [
  { value: "invoice", label: "Medical Bill" },
  { value: "payment_receipt", label: "Payment Receipt" },
  { value: "eob", label: "Explanation of Benefits (EOB)" },
  { value: "prescription_label", label: "Prescription Label" },
  { value: "receipt", label: "General Receipt" },
  { value: "other", label: "Other Document" },
];

export function MultiFileUpload({
  onFilesChange,
  disabled,
}: MultiFileUploadProps) {
  const [files, setFiles] = useState<FileWithMetadata[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const selectedFiles = Array.from(e.target.files);

    // Validate files before adding
    const { valid, invalid } = validateFiles(selectedFiles);

    // Show error for invalid files
    if (invalid.length > 0) {
      const errorMessages = invalid
        .map(({ file, errors }) => `${file.name}: ${errors[0]}`)
        .join("\n");

      toast.error(`${invalid.length} file(s) rejected:\n${errorMessages}`, {
        duration: 5000,
      });
    }

    // Add valid files
    if (valid.length > 0) {
      const newFiles: FileWithMetadata[] = valid.map((file) => ({
        file,
        documentType: "receipt",
        description: "",
        id: Math.random().toString(36).substring(7),
      }));

      const updatedFiles = [...files, ...newFiles];
      setFiles(updatedFiles);
      onFilesChange(updatedFiles);

      if (valid.length > 0 && invalid.length > 0) {
        toast.success(`${valid.length} file(s) added successfully`);
      }
    }

    // Reset input
    e.target.value = "";
  };

  const updateFileMetadata = (
    id: string,
    field: "documentType" | "description",
    value: string,
  ) => {
    const updatedFiles = files.map((f) =>
      f.id === id ? { ...f, [field]: value } : f,
    );
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);
  };

  const removeFile = (id: string) => {
    const updatedFiles = files.filter((f) => f.id !== id);
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="file-upload" className="mb-2 block">
          Upload Documents
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="file-upload"
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,.gif,.webp,image/jpeg,image/png,application/pdf,image/gif,image/webp"
            multiple
            onChange={handleFileSelect}
            disabled={disabled}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => document.getElementById("file-upload")?.click()}
            disabled={disabled}
          >
            <Upload className="h-4 w-4 mr-2" />
            Add Documents
          </Button>
          {files.length > 0 && (
            <Badge variant="secondary">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((fileData, _index) => (
            <div
              key={fileData.id}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 flex-1">
                  {fileData.file.type.startsWith("image/") ? (
                    <ImageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {fileData.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(fileData.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFile(fileData.id)}
                  disabled={disabled}
                  className="flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`doc-type-${fileData.id}`}
                    className="text-xs"
                  >
                    Document Type
                  </Label>
                  <Select
                    value={fileData.documentType}
                    onValueChange={(value) =>
                      updateFileMetadata(fileData.id, "documentType", value)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id={`doc-type-${fileData.id}`}>
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

                <div className="space-y-1.5">
                  <Label
                    htmlFor={`description-${fileData.id}`}
                    className="text-xs"
                  >
                    Description (Optional)
                  </Label>
                  <Input
                    id={`description-${fileData.id}`}
                    placeholder="e.g., March payment #3 of 12"
                    value={fileData.description}
                    onChange={(e) =>
                      updateFileMetadata(
                        fileData.id,
                        "description",
                        e.target.value,
                      )
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
