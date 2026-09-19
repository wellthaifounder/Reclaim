import { documentTypeLabel } from "./documentTypes";

// The shape of a claim, and nothing else.
//
// Deliberately free of Supabase, jsPDF and the DOM: both the record generator
// and the ZIP packet builder depend on these definitions, and keeping them in
// their own module means the packet builder — which decides where every file
// lands inside an archive a custodian will extract on their own machine — can
// be tested directly rather than only through the browser.

/**
 * One supporting document attached to an expense.
 *
 * Workstream E3. This replaced a bare `string[]` of storage paths: the claim
 * packet names each file after what it actually is ("02-itemized-statement.pdf"
 * rather than "02-document.pdf"), and a custodian reading the archive should not
 * have to open every file to find out which is the itemised statement.
 */
export interface ClaimDocument {
  path: string; // storage key under the receipts bucket — not a URL
  type: string | null; // receipts.document_type
  description: string | null;
}

// The labels themselves live in documentTypes, next to the pickers that write
// them, so the name on a badge and the name inside the packet cannot drift.
// They are re-exported here because this module is the packet's public shape.
export { DOCUMENT_TYPE_LABELS } from "./documentTypes";

export function documentLabel(doc: ClaimDocument): string {
  return documentTypeLabel(doc.type);
}

export interface SubstantiationExpenseInput {
  invoiceId: string;
  vendor: string;
  date: string; // YYYY-MM-DD — date of SERVICE
  patientName: string | null;
  category: string | null;
  amount: number;
  ruleName: string | null;
  ruleSectionRef: string | null;
  confirmedAt: string; // ISO timestamp
  documents: ClaimDocument[];
  /**
   * `none` | `partial` | `complete`. Only used to tell apart the two reasons an
   * expense can carry no file: medical mileage, which is substantiated by its
   * trip log and is deliberately `complete` with nothing attached, versus an
   * expense that is genuinely still missing its paperwork. Reporting the first
   * as the second would tell a custodian a correct claim was incomplete.
   */
  documentationState: string | null;
}

export interface SubstantiationHeader {
  recordNumber: string;
  taxYear: number;
  generatedAt: string;
  userName: string;
  totalAmount: number;
  expenseCount: number;
  /**
   * Which document this is.
   *
   * A `claim` is being filed now and closes with instructions for filing it. A
   * `record` claims nothing — it is kept against a distribution the holder may
   * take years from now — so it must not print submission instructions for a
   * submission that is not happening, and closes with retention guidance
   * instead. Without this the two documents were byte-identical apart from the
   * custodian name, and a saved record told its reader to go and submit it.
   */
  purpose: "record" | "claim";
  /** Who the claim is addressed to, if known. Drives submission instructions. */
  custodian: string | null;
  /** Spec Gate 4 — not deducted on Schedule A, not reimbursed by an FSA/HRA. */
  attestedNoDoubleBenefit: boolean;
  attestedAt: string | null;
}

/**
 * Spec Gate 4, the honor-system one. Not a workflow step and not something
 * Reclaim can check — the user asserts it once, on the claim.
 */
export const ATTESTATION_STATEMENT =
  "The account holder confirms that no expense in this record was claimed as an itemized medical deduction on Schedule A, and that none was reimbursed by a Flexible Spending Account, a Health Reimbursement Arrangement, or any other plan. Each expense is claimed once, from this HSA only.";

/**
 * What a kept record says about itself, where a claim says how to submit.
 *
 * The dates are the point. Notice 2004-50 Q&A-39 sets no deadline for taking a
 * distribution against an expense already paid — which is the whole shoebox
 * strategy — but the permission is explicitly conditional on the holder being
 * able to produce the records. Once the distribution is taken, the ordinary
 * assessment periods apply to the return reporting it: three years under
 * §6501(a), six under §6501(e) where gross income was substantially understated.
 *
 * Deliberately not "keep for six years." That number appeared on the retired
 * tax package as a flat rule; it is neither the floor nor the ceiling, and on a
 * record whose value is surviving an examination twenty years out it was the
 * most misleading sentence in the document.
 */
export const RETENTION_STATEMENT =
  "Keep this record, and the documents behind it, for as long as you might still reimburse yourself for these expenses. The IRS sets no deadline for taking an HSA distribution against an expense you have already paid (Notice 2004-50, Q&A-39) — but that permission depends on your being able to produce records like this one. Once you do take the distribution, keep this record until the return reporting it can no longer be examined: generally three years after you file it, and six if income was substantially understated.";

/**
 * The order expenses appear in, everywhere.
 *
 * The cover PDF says "Expense 3 of 7" and the packet names a folder "03-…".
 * Those have to be the same expense, in the original packet and in one rebuilt
 * from the snapshot months later — so the ordering is fixed here rather than
 * left to whatever order the rows happened to arrive in. Matches the ORDER BY
 * in `claimable_expenses()` and `record_packet_items()`.
 */
export function orderForPacket(
  expenses: SubstantiationExpenseInput[],
): SubstantiationExpenseInput[] {
  return [...expenses].sort(
    (a, b) => a.date.localeCompare(b.date) || a.vendor.localeCompare(b.vendor),
  );
}

/**
 * Kept as a named re-export because the claim packet reads better with it, but
 * it no longer has its own implementation. The previous one called
 * `toLocaleString` directly on the argument, which throws on a null amount.
 */
export { formatCurrency as formatClaimMoney } from "@/lib/utils";
