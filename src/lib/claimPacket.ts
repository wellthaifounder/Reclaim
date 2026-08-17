// Workstream E3 — the claim packet.
//
// One ZIP the user can hand their custodian: every supporting document for the
// claim, the cover summary PDF, the machine-readable CSV, and a README telling
// whoever opens it what it is and how to submit it.
//
// WHY THIS IS BUILT IN THE BROWSER, not in an edge function:
//
//   - The client already holds authorised access to exactly these files. Zipping
//     them here exposes nothing that was not already available to this session.
//   - Building it server-side would mean assembling a PHI-laden archive in a
//     Deno function, holding every receipt in its memory at once, and then
//     either streaming it back or writing it to storage — where it becomes a
//     second copy of the user's medical documents with its own lifecycle,
//     retention and deletion problem. The existing record generator makes the
//     same call for the same reason: nothing derived is persisted server-side.
//   - Packet size is set by how many photos a person attached to a year of
//     medical expenses. Typical is a handful of files at a few hundred KB each.
//     fflate's streaming writer means peak memory is roughly one document plus
//     the archive built so far, not the sum of everything.
//
// The size ceiling below is the honest limit of that choice. A packet that
// exceeds it stops adding documents and says exactly which ones it left out,
// rather than crashing the tab — the summary PDF and CSV are the substantiating
// core, and a truncated packet that names its own gaps is worth more than a
// browser that dies at 95%.
//
// NAMING. Everything that goes into the archive is slugified, including vendor
// names, which are user data and reach this code unvalidated. A vendor called
// "../../etc" must not become a path traversal in an archive a custodian
// extracts on their own machine.

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { logError } from "@/utils/errorHandler";
import { custodianSubmissionInstructions } from "@/lib/custodianInstructions";
import {
  ATTESTATION_STATEMENT,
  documentLabel,
  formatClaimMoney as fmtMoney,
  orderForPacket,
  type ClaimDocument,
  type SubstantiationExpenseInput,
  type SubstantiationHeader,
} from "@/lib/claimTypes";

/** Stop adding documents past this. See the note above. */
const MAX_PACKET_BYTES = 128 * 1024 * 1024;

export interface ClaimPacketReport {
  blob: Blob;
  /** Documents actually written into the archive. */
  documentCount: number;
  /** Documents that should have been there and are not, with the reason. */
  omissions: string[];
  /** Expenses carrying no document that ought to have one. */
  undocumented: string[];
  truncated: boolean;
  totalBytes: number;
}

export interface ClaimPacketInputs {
  coverPdf: Blob;
  csv: string;
  /**
   * Fetch one document by its storage path, or null if it cannot be had.
   *
   * Injected rather than imported so this module knows nothing about Supabase:
   * where the files come from is not the packet's business, and it makes the
   * archive's own behaviour — naming, ordering, size ceiling, what it admits to
   * leaving out — testable without a database or a browser.
   */
  fetchDocument: (path: string) => Promise<Blob | null>;
  onProgress?: (message: string) => void;
}

// ── Naming ────────────────────────────────────────────────────────────────

/**
 * Make an arbitrary string safe as one path segment inside a ZIP.
 *
 * Drops everything that is not a letter, digit or dash. That kills path
 * separators, `..`, control characters, and the characters Windows refuses in a
 * filename, all at once — a whitelist rather than a list of things to escape,
 * because the blacklist is the version that gets a hole in it.
 */
function slug(value: string, maxLength = 40): string {
  const cleaned = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return cleaned || "document";
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "image/tiff": "tif",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/**
 * File extension for a downloaded document.
 *
 * The stored MIME type wins, because it is what the browser actually reported
 * for the bytes. Storage paths are the fallback and are not always suffixed.
 */
function extensionFor(mime: string, path: string): string {
  const fromMime = MIME_EXTENSIONS[mime.split(";")[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  const fromPath = /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1]?.toLowerCase();
  if (fromPath) return fromPath;
  return "bin";
}

/** `03-northside-dental-2025-03-05` — matches "Expense 3 of 7" in the PDF. */
function expenseFolder(
  index: number,
  expense: SubstantiationExpenseInput,
): string {
  return `${String(index).padStart(2, "0")}-${slug(expense.vendor)}-${expense.date}`;
}

function documentName(
  index: number,
  doc: ClaimDocument,
  extension: string,
): string {
  return `${String(index).padStart(2, "0")}-${slug(documentLabel(doc), 32)}.${extension}`;
}

// ── The archive writer ────────────────────────────────────────────────────

interface ZipWriter {
  /** Already-compressed bytes (photos, PDFs) — stored, not deflated again. */
  store: (name: string, data: Uint8Array) => void;
  /** Text, which deflates to a fraction of its size. */
  deflate: (name: string, text: string) => void;
  finish: () => Promise<Blob>;
}

function createZipWriter(): ZipWriter {
  const chunks: Uint8Array[] = [];
  let resolve!: (blob: Blob) => void;
  let reject!: (err: unknown) => void;
  const done = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      reject(err);
      return;
    }
    if (chunk) chunks.push(chunk);
    if (final) resolve(new Blob(chunks, { type: "application/zip" }));
  });

  return {
    store(name, data) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(data, true);
    },
    deflate(name, text) {
      const entry = new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(new TextEncoder().encode(text), true);
    },
    finish() {
      zip.end();
      return done;
    },
  };
}

// ── README ───────────────────────────────────────────────────────────────

function buildReadme(
  header: SubstantiationHeader,
  expenses: SubstantiationExpenseInput[],
): string {
  const lines: string[] = [];
  const rule = "=".repeat(72);

  lines.push(rule);
  lines.push(`HSA REIMBURSEMENT CLAIM — ${header.recordNumber}`);
  lines.push(rule);
  lines.push("");
  lines.push(`Account holder    ${header.userName}`);
  lines.push(`Tax year          ${header.taxYear}`);
  lines.push(`Expenses          ${header.expenseCount}`);
  lines.push(`Amount claimed    ${fmtMoney(header.totalAmount)}`);
  if (header.custodian) lines.push(`Custodian         ${header.custodian}`);
  lines.push(`Prepared          ${new Date(header.generatedAt).toISOString()}`);
  lines.push("");

  lines.push("HOW TO SUBMIT");
  lines.push("-".repeat(72));
  lines.push(custodianSubmissionInstructions(header.custodian));
  lines.push("");

  if (header.attestedNoDoubleBenefit) {
    lines.push("ATTESTATION — NO DOUBLE BENEFIT");
    lines.push("-".repeat(72));
    lines.push(ATTESTATION_STATEMENT);
    if (header.attestedAt) {
      lines.push(`Confirmed at ${header.attestedAt}.`);
    }
    lines.push("");
  }

  lines.push("WHAT IS IN THIS PACKET");
  lines.push("-".repeat(72));
  lines.push(
    `${header.recordNumber}.pdf   The claim summary. One page per expense with`,
  );
  lines.push(
    "                        the patient, date of service, provider, IRS",
  );
  lines.push(
    "                        Publication 502 basis, amount, and the date",
  );
  lines.push(
    "                        the account holder confirmed it as eligible.",
  );
  lines.push(
    `${header.recordNumber}.csv   The same expenses as a spreadsheet.`,
  );
  lines.push(
    "documents/              The supporting documents, one folder per",
  );
  lines.push(
    "                        expense, numbered to match the summary PDF.",
  );
  lines.push("");

  lines.push("EXPENSES AND THEIR DOCUMENTS");
  lines.push("-".repeat(72));
  expenses.forEach((expense, i) => {
    const index = i + 1;
    lines.push(
      `${String(index).padStart(2, "0")}. ${expense.vendor} — ${expense.date} — ${fmtMoney(expense.amount)}`,
    );
    lines.push(`    Patient: ${expense.patientName ?? "Self"}`);
    lines.push(
      `    Basis:   ${
        expense.ruleName
          ? `${expense.ruleName}${expense.ruleSectionRef ? ` (${expense.ruleSectionRef})` : ""}`
          : "not classified"
      }`,
    );
    if (expense.documents.length === 0) {
      lines.push(
        expense.documentationState === "complete"
          ? "    Documents: none — substantiated by the details recorded in Reclaim."
          : "    Documents: none attached.",
      );
    } else {
      lines.push(`    Documents: documents/${expenseFolder(index, expense)}/`);
      for (const doc of expense.documents) {
        lines.push(
          `      - ${documentLabel(doc)}${doc.description ? `: ${doc.description}` : ""}`,
        );
      }
    }
    lines.push("");
  });

  lines.push("-".repeat(72));
  lines.push(
    "If any document could not be included, MISSING-DOCUMENTS.txt in this",
  );
  lines.push(
    "folder lists it and why. No such file means everything listed above is",
  );
  lines.push("present.");
  lines.push("");
  lines.push("Prepared with Reclaim.");

  return lines.join("\r\n");
}

function buildMissingReport(
  header: SubstantiationHeader,
  omissions: string[],
  undocumented: string[],
  truncated: boolean,
): string {
  const lines: string[] = [];
  lines.push(`MISSING FROM ${header.recordNumber}`);
  lines.push("=".repeat(72));
  lines.push("");

  if (omissions.length > 0) {
    lines.push("Documents that could not be included:");
    for (const item of omissions) lines.push(`  - ${item}`);
    lines.push("");
    if (truncated) {
      lines.push(
        "This packet reached its size limit. Claiming fewer expenses at a time",
      );
      lines.push("will produce a complete packet for each.");
      lines.push("");
    } else {
      lines.push(
        "These files are still in the Reclaim account and can be downloaded",
      );
      lines.push("individually, or this packet can be generated again.");
      lines.push("");
    }
  }

  if (undocumented.length > 0) {
    lines.push("Expenses with no supporting document attached:");
    for (const item of undocumented) lines.push(`  - ${item}`);
    lines.push("");
    lines.push(
      "A custodian may ask for a receipt or itemized statement for these.",
    );
    lines.push("");
  }

  return lines.join("\r\n");
}

// ── Public builder ───────────────────────────────────────────────────────

/**
 * Build the ZIP claim packet.
 *
 * `expenses` must be the same array, in the same order, that produced
 * `coverPdf` and `csv` — the folder numbering here and the "Expense N of M"
 * headings there are the custodian's only way to match a file to a line.
 * Both callers pass the output of `orderForPacket()`; this re-applies it so a
 * future caller cannot silently break the correspondence.
 */
export async function buildClaimPacket(
  header: SubstantiationHeader,
  expenses: SubstantiationExpenseInput[],
  { coverPdf, csv, fetchDocument, onProgress }: ClaimPacketInputs,
): Promise<ClaimPacketReport> {
  const ordered = orderForPacket(expenses);
  const root = slug(header.recordNumber, 32).toUpperCase();
  const writer = createZipWriter();

  const omissions: string[] = [];
  const undocumented: string[] = [];
  let documentCount = 0;
  let totalBytes = 0;
  let truncated = false;

  onProgress?.("Writing the claim summary…");
  writer.deflate(`${root}/README.txt`, buildReadme(header, ordered));

  const pdfBytes = new Uint8Array(await coverPdf.arrayBuffer());
  totalBytes += pdfBytes.byteLength;
  writer.store(`${root}/${root}.pdf`, pdfBytes);
  writer.deflate(`${root}/${root}.csv`, csv);

  const totalDocuments = ordered.reduce((n, e) => n + e.documents.length, 0);
  let attempted = 0;

  for (let i = 0; i < ordered.length; i++) {
    const expense = ordered[i];
    const index = i + 1;
    const label = `${expense.vendor} — ${expense.date}`;

    if (expense.documents.length === 0) {
      // Not an omission when the expense was never going to have a file:
      // medical mileage is substantiated by its trip log, and marked complete
      // with nothing attached on purpose.
      if (expense.documentationState !== "complete") undocumented.push(label);
      continue;
    }

    const folder = `${root}/documents/${expenseFolder(index, expense)}`;

    for (let d = 0; d < expense.documents.length; d++) {
      const doc = expense.documents[d];
      attempted++;
      onProgress?.(`Collecting documents… (${attempted} of ${totalDocuments})`);

      // eslint-disable-next-line no-await-in-loop -- sequential by design: one
      // document in memory at a time, and fflate's writer takes one stream at a
      // time.
      const blob = await fetchDocument(doc.path);
      if (!blob) {
        omissions.push(
          `${label}: ${documentLabel(doc)} — could not be retrieved`,
        );
        continue;
      }

      // Each document is measured against the remaining budget on its own,
      // rather than stopping dead at the first one that doesn't fit. One
      // oversized scan should not cost the user the six small receipts filed
      // behind it.
      if (totalBytes + blob.size > MAX_PACKET_BYTES) {
        truncated = true;
        omissions.push(`${label}: ${documentLabel(doc)} — packet size limit`);
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- see above
        const bytes = new Uint8Array(await blob.arrayBuffer());
        writer.store(
          `${folder}/${documentName(d + 1, doc, extensionFor(blob.type, doc.path))}`,
          bytes,
        );
        totalBytes += bytes.byteLength;
        documentCount++;
      } catch (err) {
        logError("claimPacket: addDocument", err);
        omissions.push(
          `${label}: ${documentLabel(doc)} — could not be added to the packet`,
        );
      }
    }
  }

  if (omissions.length > 0 || undocumented.length > 0) {
    writer.deflate(
      `${root}/MISSING-DOCUMENTS.txt`,
      buildMissingReport(header, omissions, undocumented, truncated),
    );
  }

  onProgress?.("Compressing the packet…");
  const blob = await writer.finish();

  return {
    blob,
    documentCount,
    omissions,
    undocumented,
    truncated,
    totalBytes,
  };
}
