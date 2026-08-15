import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Search, FileText, Tag } from "lucide-react";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { EditDocumentDialog } from "@/components/documents/EditDocumentDialog";
import { LinkToCollectionDialog } from "@/components/documents/LinkToCollectionDialog";
import { MultiFileUpload } from "@/components/expense/MultiFileUpload";
import { Badge } from "@/components/ui/badge";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { logError } from "@/utils/errorHandler";
interface Receipt {
  id: string;
  file_path: string;
  file_type: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
  invoice_id: string | null;
  payment_transaction_id: string | null;
  collection_id: string | null;
  collections?: {
    id: string;
    title: string;
    color: string | null;
  } | null;
}
const Documents = () => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [filteredReceipts, setFilteredReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [linkingReceiptId, setLinkingReceiptId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [newFiles, setNewFiles] = useState<any[]>([]);
  useEffect(() => {
    loadReceipts();
  }, []);
  useEffect(() => {
    filterReceipts();
  }, [receipts, searchQuery, selectedType]);
  const loadReceipts = async () => {
    try {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("receipts")
        .select(
          `
          *,
          collections (
            id,
            title,
            color
          )
        `,
        )
        .eq("user_id", user.id)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      setReceipts(data || []);
    } catch (error) {
      logError("Error loading receipts", error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };
  const filterReceipts = () => {
    let filtered = receipts;
    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.document_type?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }
    if (selectedType !== "all") {
      if (selectedType === "unattached") {
        filtered = filtered.filter(
          (r) => !r.invoice_id && !r.payment_transaction_id,
        );
      } else if (selectedType === "attached") {
        filtered = filtered.filter(
          (r) => r.invoice_id || r.payment_transaction_id,
        );
      } else {
        filtered = filtered.filter((r) => r.document_type === selectedType);
      }
    }
    setFilteredReceipts(filtered);
  };
  const handleUpload = async () => {
    if (newFiles.length === 0) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");
      for (let i = 0; i < newFiles.length; i++) {
        const fileData = newFiles[i];
        const fileExt = fileData.file.name.split(".").pop();
        const timestamp = Date.now();
        const filePath = `${user.id}/unattached/${fileData.documentType}_${timestamp}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(filePath, fileData.file);
        if (uploadError) throw uploadError;
        const { error: receiptError } = await supabase.from("receipts").insert({
          user_id: user.id,
          file_path: filePath,
          file_type: fileData.file.type,
          document_type: fileData.documentType,
          description: fileData.description || null,
          display_order: i,
        });
        if (receiptError) throw receiptError;
      }
      toast.success("Documents uploaded successfully!");
      setNewFiles([]);
      setShowUpload(false);
      loadReceipts();
    } catch (error) {
      logError("Error uploading documents", error);
      toast.error("Failed to upload documents");
    }
  };
  const handleDelete = async (receiptId: string) => {
    try {
      const receipt = receipts.find((r) => r.id === receiptId);
      if (!receipt) return;
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("receipts")
        .remove([receipt.file_path]);
      if (storageError) throw storageError;
      // Delete from database
      const { error: dbError } = await supabase
        .from("receipts")
        .delete()
        .eq("id", receiptId);
      if (dbError) throw dbError;
      toast.success("Document deleted successfully");
      loadReceipts();
    } catch (error) {
      logError("Error deleting document", error);
      toast.error("Failed to delete document");
    }
  };
  const documentTypes = [
    "receipt",
    "invoice",
    "eob",
    "payment_confirmation",
    "medical_record",
  ];
  const attachmentStatus = ["all", "attached", "unattached"];
  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-6 w-6" />
                  Documents Center
                </CardTitle>
                <CardDescription>
                  Manage all your healthcare documents in one place
                </CardDescription>
              </div>
              <Button onClick={() => setShowUpload(!showUpload)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Documents
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showUpload && (
              <div className="mb-6 p-4 border rounded-lg bg-muted/50">
                <MultiFileUpload onFilesChange={setNewFiles} disabled={false} />
                {newFiles.length > 0 && (
                  <Button onClick={handleUpload} className="mt-4">
                    Upload {newFiles.length} Document
                    {newFiles.length > 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Filter by:
                </span>
                {attachmentStatus.map((status) => (
                  <Badge
                    key={status}
                    variant={selectedType === status ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setSelectedType(status)}
                  >
                    {status}
                  </Badge>
                ))}
                {documentTypes.map((type) => (
                  <Badge
                    key={type}
                    variant={selectedType === type ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setSelectedType(type)}
                  >
                    {type.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              Loading documents...
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No documents found</p>
              {searchQuery && (
                <Button
                  variant="link"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedType("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            filteredReceipts.map((receipt) => (
              <DocumentCard
                key={receipt.id}
                receipt={receipt}
                onEdit={() => setEditingReceipt(receipt)}
                onDelete={handleDelete}
                onLinkToCollection={() => setLinkingReceiptId(receipt.id)}
              />
            ))
          )}
        </div>
      </div>
      {editingReceipt && (
        <EditDocumentDialog
          receipt={editingReceipt}
          open={!!editingReceipt}
          onOpenChange={(open) => !open && setEditingReceipt(null)}
          onSaved={() => {
            loadReceipts();
            setEditingReceipt(null);
          }}
        />
      )}
      {linkingReceiptId && (
        <LinkToCollectionDialog
          open={!!linkingReceiptId}
          onOpenChange={(open) => !open && setLinkingReceiptId(null)}
          documentId={linkingReceiptId}
          onSuccess={loadReceipts}
        />
      )}
    </AuthenticatedLayout>
  );
};
export default Documents;
