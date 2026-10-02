// "Looks like a match: [document] · Attach" (SUBSTANTIATE_SPEC S4).
//
// When exactly one saved document's scanned amount and date line up with this
// charge, it is offered before the picker is opened. It never attaches
// anything on its own: the app suggests, the person decides -- the same rule
// as everywhere else (spec §4).
//
// Shown only while nothing is attached yet. Once there is proof on the
// expense, a second suggestion is noise; anything further is a pick from the
// library, which lists the likely matches first (S3).

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logError } from "@/utils/errorHandler";
import {
  useAttachDocuments,
  useClearMatch,
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
}

export function LikelyMatchOffer({
  invoiceId,
  onAttached,
}: LikelyMatchOfferProps) {
  const match = useClearMatch(invoiceId);
  const thumbnails = useThumbnailUrls(match ? [match] : []);
  const attach = useAttachDocuments();
  const [attaching, setAttaching] = useState(false);
  // Not this one: hidden until the expense is opened again.
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!match || dismissed === match.id) return null;

  const handleAttach = async () => {
    setAttaching(true);
    try {
      await attach([match.id], [invoiceId]);
      toast.success("Document attached.");
      onAttached([match.id]);
    } catch (error) {
      logError("Error attaching a matched document", error);
      toast.error("We couldn't attach that document. Please try again.");
    } finally {
      setAttaching(false);
    }
  };

  return (
    // Wraps on a phone: the buttons drop below the name rather than squeeze it.
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <DocumentThumbnail url={thumbnails?.get(match.file_path)} />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm">
          <span className="text-muted-foreground">Looks like a match: </span>
          <span className="font-medium break-words">{documentName(match)}</span>
        </p>
        <ScannedFacts doc={match} />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          onClick={() => void handleAttach()}
          disabled={attaching}
        >
          {attaching && (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Attach
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Not this one"
          onClick={() => setDismissed(match.id)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
