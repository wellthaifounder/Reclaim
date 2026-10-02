import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Search, FileText, Tag, Loader2 } from "lucide-react";
import { toUploadableFile } from "@/utils/heicConversion";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { EditDocumentDialog } from "@/components/documents/EditDocumentDialog";
import { MultiFileUpload } from "@/components/expense/MultiFileUpload";
import {
  DEFAULT_DOCUMENT_TYPE,
  DOCUMENT_TYPES,
  documentTypeLabel,
} from "@/lib/documentTypes";
import { Badge } from "@/components/ui/badge";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { logError } from "@/utils/errorHandler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Money } from "@/components/ui/money";
import { formatDateOnly } from "@/lib/dates";
import { useScanDocument } from "@/hooks/useDocumentScan";
import type { LibraryDocument } from "@/hooks/useDocumentLibrary";
interface Receipt {
  id: string;
  file_path: string;
  file_name: string | null;
  file_type: string;
  document_type: string | null;
  description: string | null;
  uploaded_at: string;
  /** What the scan read (SUBSTANTIATE_SPEC S6), once it has. */
  scan: LibraryDocument["scan"];
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
  const [uploading, setUploading] = useState(false);
  const scan = useScanDocument();
  // Bumped after every upload attempt to remount the picker empty. It owns its
  // own file list, so clearing newFiles here would not clear what it shows.
  const [pickerKey, setPickerKey] = useState(0);
  // The document awaiting delete confirmation, and the expenses it backs
  // (null while those are still loading).
  const [pendingDelete, setPendingDelete] = useState<{
    receipt: Receipt;
    backs:
      { id: string; vendor: string; date: string; amount: number }[] | null;
  } | null>(null);
  // quiet: refresh in place, without blanking the grid to "Loading" -- for
  // the re-read after a scan, which nobody asked for and nobody waits on.
  const loadReceipts = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
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
              "id, file_path, file_name, file_type, document_type, description, uploaded_at, receipt_ocr_data(scan_status, extracted_amount, extracted_vendor, extracted_date, extracted_bill_date, extracted_service_date, extracted_service_date_end)",
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
      setReceipts(
        (data ?? []).map(({ receipt_ocr_data, ...r }) => {
          const joined = receipt_ocr_data as unknown;
          const scan = (Array.isArray(joined) ? joined[0] : joined) as
            Receipt["scan"] | undefined;
          return { ...r, scan: scan ?? null };
        }),
      );
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
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.file_name?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          // Match the name on the badge, not the stored value: someone
          // searching "bill" is looking at a card that says Bill, while the
          // row underneath it says "invoice".
          documentTypeLabel(r.document_type).toLowerCase().includes(q),
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

  /**
   * Upload a batch, one file at a time, with each file's fate independent of
   * the others.
   *
   * The previous version threw on the first failure, which abandoned every
   * file after it and reported "Failed to upload documents" — while the files
   * uploaded before the failure stayed in storage and in the library. Someone
   * uploading seven bills was told nothing worked when four of them had, and
   * the reason the fifth failed was discarded: it went to logError, which is
   * dev-only, so in production nothing recorded it at all.
   *
   * So: keep going after a failure, and say which file failed and why. When a
   * file lands in storage but its row does not, the stored file is removed
   * again — otherwise storage accumulates documents that no query can ever
   * return, which is what it had already started doing.
   */
  const handleUpload = async () => {
    if (newFiles.length === 0 || uploading) return;
    setUploading(true);

    const failures: string[] = [];
    let uploaded = 0;
    const added: string[] = [];

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");

      for (let i = 0; i < newFiles.length; i++) {
        const fileData = newFiles[i];
        let filePath: string | null = null;
        try {
          // An iPhone photo arrives as HEIC, which nothing downstream can
          // read; this hands back a JPEG. Anything else passes straight
          // through.
          const file = await toUploadableFile(fileData.file);

          const fileExt = file.name.split(".").pop();
          // randomUUID, not Date.now(): two files in one batch can finish
          // inside the same millisecond, and storage refuses a path that
          // already exists rather than overwriting it.
          filePath = `${user.id}/unattached/${fileData.documentType}_${crypto.randomUUID()}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from("receipts")
            .upload(filePath, file);
          if (uploadError) throw uploadError;

          const { data: row, error: receiptError } = await supabase
            .from("receipts")
            .insert({
              user_id: user.id,
              file_path: filePath,
              // The name the user picked, kept so the card can show something
              // they recognise. The storage key above is generated and is a
              // different thing; renaming one must never move the other.
              file_name: file.name,
              file_type: file.type,
              document_type: fileData.documentType,
              // Picked in the dropdown, it is the person's; left at the
              // default, a later scan may say what it is (SUBSTANTIATE_SPEC S10).
              document_type_source:
                fileData.documentType === DEFAULT_DOCUMENT_TYPE
                  ? null
                  : "person",
              description: fileData.description || null,
              display_order: i,
            })
            .select("id")
            .single();
          if (receiptError) {
            await supabase.storage.from("receipts").remove([filePath]);
            throw receiptError;
          }

          uploaded += 1;
          added.push(row.id);
        } catch (error) {
          logError("Error uploading a document", error);
          const reason =
            error instanceof Error ? error.message : "Unknown error";
          failures.push(`${fileData.file.name} — ${reason}`);
        }
      }
    } catch (error) {
      logError("Error uploading documents", error);
      failures.push(
        error instanceof Error && error.message === "Not authenticated"
          ? "You've been signed out. Sign in again and retry."
          : "Something went wrong before the upload started.",
      );
    } finally {
      setUploading(false);
    }

    if (uploaded > 0) {
      toast.success(
        `${uploaded} document${uploaded === 1 ? "" : "s"} uploaded.`,
      );
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} couldn't be uploaded:\n${failures.join("\n")}`,
        { duration: 10000 },
      );
    }

    // The picker is reset after every attempt, including a partial one: its
    // list would otherwise still hold the files that just succeeded, and
    // pressing Upload again would store a second copy of each.
    setNewFiles([]);
    setPickerKey((k) => k + 1);
    if (failures.length === 0) setShowUpload(false);
    loadReceipts();
    void readUploads(added);
  };

  // Read at upload (SUBSTANTIATE_SPEC S6), so a document saved here can be
  // matched to the charge it proves (S3, S4) and fills the form when it is
  // attached, without a second read (S11). One at a time: nobody waits on it,
  // and a batch of bills fired at once is how the AI service's rate limit is
  // reached. A failed read is not lost -- the document is read when attached.
  const readUploads = async (receiptIds: string[]) => {
    for (const receiptId of receiptIds) {
      await scan.mutateAsync({ receiptId }).catch(() => undefined);
    }
    if (receiptIds.length > 0) loadReceipts({ quiet: true });
  };
  // Deleting here is the only way a file is deleted for good -- ✕ on an
  // expense only detaches it (SUBSTANTIATE_SPEC S5) -- so it asks first, and
  // names every expense that would lose its proof. One hospital bill can back
  // several instalments; "Delete?" alone would not say that.
  const askDelete = async (receiptId: string) => {
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) return;
    setPendingDelete({ receipt, backs: null });
    const { data, error } = await supabase
      .from("receipt_invoices")
      .select("invoices!inner(id, vendor, date, amount)")
      .eq("receipt_id", receiptId);
    if (error) {
      logError("Error loading a document's expenses", error);
      toast.error("We couldn't check which expenses use this document.");
      setPendingDelete(null);
      return;
    }
    const backs = (data ?? [])
      .map((row) => row.invoices)
      .sort((a, b) => b.date.localeCompare(a.date));
    setPendingDelete((p) =>
      p?.receipt.id === receiptId ? { receipt, backs } : p,
    );
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
  // Chips come from the shared list, so a type that can be chosen is always a
  // type that can be filtered for. The old hand-written list carried two values
  // ('payment_confirmation', 'medical_record') that nothing could ever be, so
  // those two chips emptied the page every time they were tapped.
  const documentTypes = DOCUMENT_TYPES;
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
                <MultiFileUpload
                  key={pickerKey}
                  onFilesChange={setNewFiles}
                  disabled={uploading}
                />
                {newFiles.length > 0 && (
                  <Button
                    onClick={handleUpload}
                    className="mt-4"
                    disabled={uploading}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading {newFiles.length} document
                        {newFiles.length > 1 ? "s" : ""}…
                      </>
                    ) : (
                      <>
                        Upload {newFiles.length} Document
                        {newFiles.length > 1 ? "s" : ""}
                      </>
                    )}
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
                    key={type.value}
                    variant={
                      selectedType === type.value ? "default" : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => setSelectedType(type.value)}
                  >
                    {type.label}
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
                onDelete={(rid) => void askDelete(rid)}
              />
            ))
          )}
        </div>
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document for good?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {pendingDelete?.backs == null ? (
                  <p className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking which expenses use it…
                  </p>
                ) : pendingDelete.backs.length === 0 ? (
                  <p>It isn't attached to any expense. This can't be undone.</p>
                ) : (
                  <>
                    <p>
                      {pendingDelete.backs.length === 1
                        ? "This expense will lose it:"
                        : `These ${pendingDelete.backs.length} expenses will lose it:`}
                    </p>
                    <ul className="space-y-1 text-foreground">
                      {pendingDelete.backs.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            {inv.vendor} · {formatDateOnly(inv.date)}
                          </span>
                          <Money value={Number(inv.amount)} />
                        </li>
                      ))}
                    </ul>
                    <p>This can't be undone.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pendingDelete?.backs == null}
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete.receipt.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
