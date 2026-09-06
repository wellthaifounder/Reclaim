import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Search, FileText, Tag } from "lucide-react";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { EditDocumentDialog } from "@/components/documents/EditDocumentDialog";
import { MultiFileUpload } from "@/components/expense/MultiFileUpload";
import { Badge } from "@/components/ui/badge";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { logError } from "@/utils/errorHandler";
interface Receipt {
  id: string;
  file_path: string;
  file_type: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
}

/** A file chosen in the upload panel but not yet sent to storage. */
interface PendingUpload {
  file: File;
  documentType: string;
  description?: string;
}
const Documents = () => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [filteredReceipts, setFilteredReceipts] = useState<Receipt[]>([]);
  // How many expenses each document is attached to, via receipt_invoices.
  // A document with no entry here is unattached.
  const [attachedCounts, setAttachedCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [newFiles, setNewFiles] = useState<PendingUpload[]>([]);
  const loadReceipts = async () => {
    try {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");
      const [{ data, error }, { data: links, error: linksError }] =
        await Promise.all([
          supabase
            .from("receipts")
            // Columns enumerated rather than `*`: `receipts` gains columns
            // over time and a wildcard here would start shipping them to the
            // client the moment they land.
            .select(
              "id, file_path, file_type, document_type, description, uploaded_at",
            )
            .eq("user_id", user.id)
            .order("uploaded_at", { ascending: false }),
          // Attachment now lives in receipt_invoices, not receipts.invoice_id
          // -- a document can be attached to more than one expense.
          supabase
            .from("receipt_invoices")
            .select("receipt_id")
            .eq("user_id", user.id),
        ]);
      if (error) throw error;
      if (linksError) throw linksError;
      const counts = new Map<string, number>();
      for (const l of links ?? []) {
        counts.set(l.receipt_id, (counts.get(l.receipt_id) ?? 0) + 1);
      }
      setAttachedCounts(counts);
      setReceipts(data || []);
    } catch (error) {
      logError("Error loading receipts", error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };
  const filterReceipts = useCallback(() => {
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
        filtered = filtered.filter((r) => !attachedCounts.get(r.id));
      } else if (selectedType === "attached") {
        filtered = filtered.filter((r) => attachedCounts.get(r.id));
      } else {
        filtered = filtered.filter((r) => r.document_type === selectedType);
      }
    }
    setFilteredReceipts(filtered);
  }, [receipts, attachedCounts, searchQuery, selectedType]);

  useEffect(() => {
    loadReceipts();
  }, []);
  useEffect(() => {
    filterReceipts();
  }, [filterReceipts]);

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
      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8">
        <Card className="mb-6">
          <CardHeader>
            <PageHeader
              title={
                <span className="flex items-center gap-2 text-2xl">
                  <FileText className="h-6 w-6 shrink-0" />
                  Documents Center
                </span>
              }
              description="Manage all your healthcare documents in one place"
              action={
                <Button
                  onClick={() => setShowUpload(!showUpload)}
                  className="w-full sm:w-auto"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Documents
                </Button>
              }
            />
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
                attachedCount={attachedCounts.get(receipt.id) ?? 0}
                onEdit={() => setEditingReceipt(receipt)}
                onDelete={handleDelete}
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
    </AuthenticatedLayout>
  );
};
export default Documents;
