// Choose from Documents (SUBSTANTIATE_SPEC S1, S3).
//
// The person's saved documents, with the ones whose scanned amount and date
// line up with this charge listed first under "Likely matches", then
// everything else, newest first. A search box and a thumbnail of each, so the
// right bill can be picked out of a long library without opening every file.
//
// Matching is for one expense only. From the queue's bulk bar there is no one
// payment to match, so the list is simply newest first.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { logError } from "@/utils/errorHandler";
import { Calendar, FileText, Search } from "lucide-react";
import { format } from "date-fns";
import { documentTypeLabel } from "@/lib/documentTypes";
import {
  useAttachDocuments,
  usePickableDocuments,
  useThumbnailUrls,
  documentName,
  type LibraryDocument,
} from "@/hooks/useDocumentLibrary";
import {
  DocumentThumbnail,
  ScannedFacts,
} from "@/components/documents/DocumentSummary";

interface AttachDocumentDialogProps {
  /** The expenses to attach to. One from an expense's own row; several when
   *  the substantiate queue's bulk bar opens this — a payment plan is several
   *  expenses backed by the same document. */
  invoiceIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the documents just attached, so the caller can scan them. */
  onAttached: (receiptIds: string[]) => void;
  /** Ticked when the picker opens: "N look like a match · Review" (S4). */
  preselected?: string[];
}

type PickableDocument = LibraryDocument & {
  /** How many of the expenses being attached to already have it. Only a
   *  document on ALL of them is hidden; one on some is still worth offering,
   *  because attaching fills the gaps. */
  attachedHereCount: number;
  /** How many OTHER expenses it already backs. A document can substantiate
   *  more than one expense (a hospital bill paid in instalments, say), so
   *  this is a hint, not an exclusion. */
  attachedElsewhereCount: number;
};

function matchesSearch(doc: LibraryDocument, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    doc.file_name,
    doc.description,
    doc.scan?.extracted_vendor,
    // The name on the badge, not the stored value: someone searching "bill"
    // is looking at a badge that says Bill over a row that says "invoice".
    documentTypeLabel(doc.document_type),
  ].some((s) => s?.toLowerCase().includes(q));
}

export const AttachDocumentDialog = ({
  invoiceIds,
  open,
  onOpenChange,
  onAttached,
  preselected,
}: AttachDocumentDialogProps) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [attaching, setAttaching] = useState(false);
  const { matches, rest, isLoading, error } = usePickableDocuments(
    invoiceIds,
    open,
  );
  const attach = useAttachDocuments();
  const thumbnails = useThumbnailUrls(open ? [...matches, ...rest] : []);

  // The prop is an array, so a caller passing a fresh literal would re-run
  // the reset on every render. The joined key is what actually changes.
  const preselectedKey = (preselected ?? []).join(",");
  useEffect(() => {
    if (open) {
      // Reset on open, not on close: reopening the dialog otherwise starts
      // with the ticks and the search from the last time it was used.
      setSelectedIds(preselectedKey ? preselectedKey.split(",") : []);
      setSearch("");
    }
  }, [open, preselectedKey]);

  useEffect(() => {
    if (!error) return;
    logError("Error loading documents to attach", error);
    toast.error("Failed to load documents");
  }, [error]);

  const shownMatches = matches.filter((d) => matchesSearch(d, search));
  const shownRest = rest.filter((d) => matchesSearch(d, search));
  const nothingSaved = matches.length + rest.length === 0;

  const handleAttach = async () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one document");
      return;
    }

    try {
      setAttaching(true);
      await attach(selectedIds, invoiceIds);
      const docs = `${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"}`;
      toast.success(
        invoiceIds.length === 1
          ? `${docs} attached.`
          : `${docs} attached to ${invoiceIds.length} expenses.`,
      );
      onAttached(selectedIds);
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

  const renderRow = (doc: PickableDocument) => (
    <div
      key={doc.id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
      onClick={() => toggleSelection(doc.id)}
    >
      <Checkbox
        checked={selectedIds.includes(doc.id)}
        onCheckedChange={() => toggleSelection(doc.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={documentName(doc)}
      />
      <DocumentThumbnail url={thumbnails?.get(doc.file_path)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {documentTypeLabel(doc.document_type)}
          </Badge>
        </div>
        {/* Named, so the list reads the way the Documents page reads. */}
        <p className="text-sm font-medium break-words">{documentName(doc)}</p>
        {doc.file_name && doc.description && (
          <p className="text-sm text-muted-foreground">{doc.description}</p>
        )}
        <ScannedFacts doc={doc} />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" aria-hidden="true" />
          {format(new Date(doc.uploaded_at), "MMM d, yyyy")}
        </div>
        {doc.attachedHereCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Already on {doc.attachedHereCount} of the {invoiceIds.length}{" "}
            selected
          </p>
        )}
        {doc.attachedElsewhereCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Already attached to{" "}
            {doc.attachedElsewhereCount === 1
              ? "1 other expense"
              : `${doc.attachedElsewhereCount} other expenses`}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Choose from Documents</DialogTitle>
          {/* Said only when it is not obvious: a pick from the bulk bar lands
              on every selected expense. */}
          <DialogDescription
            className={invoiceIds.length === 1 ? "sr-only" : undefined}
          >
            {invoiceIds.length === 1
              ? "Pick documents to attach to this expense."
              : `Whatever you choose is attached to all ${invoiceIds.length} selected expenses.`}
          </DialogDescription>
        </DialogHeader>

        {!isLoading && !nothingSaved && (
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search documents"
              aria-label="Search documents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <p className="text-sm text-muted-foreground">
                Loading documents...
              </p>
            </div>
          ) : nothingSaved ? (
            <div className="py-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p>No documents available to attach</p>
              <p className="mt-1 text-sm">
                Upload documents first or check the Documents center
              </p>
            </div>
          ) : shownMatches.length + shownRest.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No documents match &ldquo;{search}&rdquo;
            </p>
          ) : (
            <>
              {shownMatches.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Likely matches</h3>
                  {shownMatches.map(renderRow)}
                </section>
              )}
              {shownRest.length > 0 && (
                <section className="space-y-2">
                  {shownMatches.length > 0 && (
                    <h3 className="text-sm font-medium">Other documents</h3>
                  )}
                  {shownRest.map(renderRow)}
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
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
