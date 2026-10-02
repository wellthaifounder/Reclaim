// One saved document, as the picker and "Looks like a match" show it
// (SUBSTANTIATE_SPEC S3, S4): a thumbnail, the name the person gave it, and
// what the scan read -- provider, amount, date -- which is what lines it up
// with a charge at a glance.

import { useState } from "react";
import { FileText } from "lucide-react";
import { Money } from "@/components/ui/money";
import { formatDateOnly } from "@/lib/dates";
import type { LibraryDocument } from "@/hooks/useDocumentLibrary";
import { documentDates, isRead } from "@/lib/documentMatch";

/** What the scan read, where a document is shown. */
type Scanned = Pick<LibraryDocument, "scan">;

/** The date a person would recognise the document by. */
function scannedDate(doc: Scanned): string | null {
  return documentDates(doc.scan)[0] ?? null;
}

/** An image's thumbnail; a PDF, or an image that will not load, shows the
 *  document icon rather than a broken picture. */
export function DocumentThumbnail({ url }: { url: string | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(url)}
        />
      ) : (
        <FileText
          className="h-5 w-5 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** "Smile Dental Group · $85.00 · Sep 12, 2026", from what the scan read. */
export function ScannedFacts({ doc }: { doc: Scanned }) {
  const s = doc.scan;
  if (!isRead(s)) return null;
  const date = scannedDate(doc);
  const amount = s.extracted_amount == null ? null : Number(s.extracted_amount);
  const parts = [
    s.extracted_vendor ? <span key="v">{s.extracted_vendor}</span> : null,
    amount != null ? <Money key="a" value={amount} /> : null,
    date ? <span key="d">{formatDateOnly(date)}</span> : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </p>
  );
}
