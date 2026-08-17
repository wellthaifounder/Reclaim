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

/** Human labels for `receipts.document_type`. */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice: "Bill",
  bill: "Bill",
  payment_receipt: "Payment receipt",
  eob: "Explanation of benefits",
  itemized_statement: "Itemized statement",
  prescription_label: "Prescription label",
  letter_of_medical_necessity: "Letter of medical necessity",
  receipt: "Receipt",
  other: "Other document",
};

export function documentLabel(doc: ClaimDocument): string {
  if (doc.type && DOCUMENT_TYPE_LABELS[doc.type])
    return DOCUMENT_TYPE_LABELS[doc.type];
  if (doc.type) return doc.type.replace(/_/g, " ");
  return "Document";
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

export function formatClaimMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
