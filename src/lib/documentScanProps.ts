// What the dialog and the full expense page both hand the panel about the
// attached documents' scans, so the two read them the same way (S35).

import { documentNoun } from "@/lib/documentTypes";
import { scanOf, type DocumentScan } from "@/hooks/useDocumentScan";

interface ScannedDocument {
  id: string;
  document_type: string | null;
  receipt_ocr_data?: DocumentScan | DocumentScan[] | null;
}

export function documentScanProps(documents: ScannedDocument[] | undefined) {
  const documentNouns: Record<string, string> = {};
  const namedPatients: { name: string; noun: string }[] = [];
  for (const doc of documents ?? []) {
    const noun = documentNoun(doc.document_type);
    documentNouns[doc.id] = noun;
    const scan = scanOf(doc);
    const name = scan?.scan_status === "read" ? scan.extracted_patient : null;
    if (name?.trim()) namedPatients.push({ name: name.trim(), noun });
  }
  return { documentNouns, namedPatients };
}

/** The matched Publication 502 category, as an embedded join returns it. */
export function qualifyingCategory(
  rule:
    | { name: string; eligibility_status: string }
    | { name: string; eligibility_status: string }[]
    | null
    | undefined,
): { name: string; status: string } | null {
  const r = Array.isArray(rule) ? rule[0] : rule;
  return r ? { name: r.name, status: r.eligibility_status } : null;
}
