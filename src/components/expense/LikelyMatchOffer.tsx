// "Looks like a match" (SUBSTANTIATE_SPEC S4, amended 2026-10-02).
//
// Saved documents that look like the proof for this charge are offered before
// the picker is opened: one by name, with Attach; several -- two photos of
// one receipt, or an invoice and its payment record -- as "N saved documents
// look like a match", with Review, which opens the picker with them ticked.
// It never attaches anything on its own: the app suggests, the person decides
// (spec §4).
//
// Shown whenever a matching document is not on this expense yet, even if
// something else is: a card slip may already be attached when the itemised
// receipt turns up.

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logError } from "@/utils/errorHandler";
import {
  useAttachDocuments,
  useLikelyMatches,
  useThumbnailUrls,
  documentName,
} from "@/hooks/useDocumentLibrary";
import {
  DocumentThumbnail,
  ScannedFacts,
} from "@/components/documents/DocumentSummary";

interface LikelyMatchOfferProps {
  invoiceId: string;
  /** Called with the attached document, so the caller can refresh and scan. */
  onAttached: (receiptIds: string[]) => void;
  /** Open the picker with these documents ticked. */
  onReview: (receiptIds: string[]) => void;
}

export function LikelyMatchOffer({
  invoiceId,
  onAttached,
  onReview,
}: LikelyMatchOfferProps) {
  const matches = useLikelyMatches(invoiceId);
  const single = matches.length === 1 ? matches[0] : null;
  const thumbnails = useThumbnailUrls(single ? [single] : []);
  const attach = useAttachDocuments();
  const [attaching, setAttaching] = useState(false);
  // ✕ hides this offer until the expense is opened again. Keyed on what was
  // offered, so a different set of matches is offered afresh.
  const offered = matches.map((d) => d.id).join(",");
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (matches.length === 0 || dismissed === offered) return null;

  const handleAttach = async (receiptId: string) => {
    setAttaching(true);
    try {
      await attach([receiptId], [invoiceId]);
      toast.success("Document attached.");
      onAttached([receiptId]);
    } catch (error) {
      logError("Error attaching a matched document", error);
      toast.error("We couldn't attach that document. Please try again.");
    } finally {
      setAttaching(false);
    }
  };

  // Dashed and labelled "Suggested": with a thumbnail and the scan's facts it
  // otherwise read as a document already attached, and an expense was
  // confirmed believing it had proof it did not.
  const suggested = (
    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
      Suggested &middot; not attached
    </p>
  );

  return (
    // Wraps on a phone: the buttons drop below the name rather than squeeze it.
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/60 bg-primary/5 p-3">
      {single ? (
        <>
          <DocumentThumbnail url={thumbnails?.get(single.file_path)} />
          <div className="min-w-0 flex-1 basis-48">
            {suggested}
            <p className="text-sm font-medium break-words">
              {documentName(single)}
            </p>
            <ScannedFacts doc={single} />
          </div>
        </>
      ) : (
        <div className="min-w-0 flex-1 basis-48">
          {suggested}
          <p className="text-sm">
            {matches.length} saved documents look like a match
          </p>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        {single ? (
          <Button
            size="sm"
            onClick={() => void handleAttach(single.id)}
            disabled={attaching}
          >
            {attaching && (
              <Loader2
                className="mr-1 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Attach
          </Button>
        ) : (
          <Button size="sm" onClick={() => onReview(matches.map((d) => d.id))}>
            Review
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Not this one"
          onClick={() => setDismissed(offered)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
