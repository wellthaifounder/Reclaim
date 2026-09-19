// The one list of document types.
//
// Until 2026-09-19 there were four, and no two agreed: the upload panel's six,
// the edit dialog's five, the Documents page's filter chips, and the claim
// packet's label map. Three options were on screen that the database refuses --
// `receipts_document_type_check` never admitted 'payment_confirmation',
// 'medical_record' or 'prescription_label' -- so choosing one failed the write.
// At upload that surfaced as a file already sitting in storage with no row and
// a batch reporting failure; in the edit dialog, as "Failed to update document"
// on two of its five choices. 'itemized_statement' had the opposite fault: the
// constraint accepts it and the claim packet already names files after it, but
// no picker offered it, so the one document the IRS actually asks for could
// never be labelled as such.
//
// This list must stay a subset of `receipts_document_type_check`. Adding an
// entry here without the matching migration puts an option on screen that the
// database will refuse, which is exactly the bug above.

export interface DocumentTypeOption {
  value: string;
  /**
   * The canonical name. Badges show it, and the claim packet slugs it into a
   * filename ("02-itemized-statement.pdf"), so changing one renames files a
   * custodian may already have received. Change these deliberately.
   */
  label: string;
  /** What the dropdown shows, where the canonical name needs a familiar cue. */
  pickerLabel?: string;
}

export const DOCUMENT_TYPES: readonly DocumentTypeOption[] = [
  { value: "itemized_statement", label: "Itemized statement" },
  { value: "invoice", label: "Bill" },
  { value: "payment_receipt", label: "Payment receipt" },
  {
    value: "eob",
    label: "Explanation of benefits",
    pickerLabel: "Explanation of benefits (EOB)",
  },
  { value: "prescription_label", label: "Prescription label" },
  { value: "payment_plan_agreement", label: "Payment plan agreement" },
  { value: "receipt", label: "Receipt" },
  { value: "other", label: "Other document" },
];

/** What an upload starts as until the person says otherwise. */
export const DEFAULT_DOCUMENT_TYPE = "receipt";

/**
 * Types the database accepts but no picker offers.
 *
 * 'bill' is the legacy spelling of 'invoice'. Two writers used it while the
 * audit checklist looked for 'invoice', so a bill entered by hand or arriving
 * by email never counted as the bill it plainly was. Both now write 'invoice'
 * and the stored rows were migrated, but the spelling stays readable here in
 * case any row was missed.
 *
 * 'letter_of_medical_necessity' is deliberately not pickable. Attaching one is
 * what clears a conditionally-eligible expense, so offering it as a relabel
 * would let someone declare their own eligibility -- and `trg_receipts_lmn`
 * only fires on INSERT and DELETE, so a type changed to it in the edit dialog
 * would not even recompute anything. Making it pickable is a schema decision,
 * not a dropdown one.
 */
export const LEGACY_DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  bill: "Bill",
  letter_of_medical_necessity: "Letter of medical necessity",
};

/**
 * Old spellings that mean an entry in the list above. Seeding a picker with the
 * raw value would otherwise show "Bill" twice -- once as the real option and
 * once as the row's own unrecognised value -- and saving converges the row on
 * the spelling everything else reads.
 */
export const DOCUMENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  bill: "invoice",
};

export function normalizeDocumentType(type: string): string {
  return DOCUMENT_TYPE_ALIASES[type] ?? type;
}

/** Every value this app can display a name for, pickable or not. */
export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  ...LEGACY_DOCUMENT_TYPE_LABELS,
  ...Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, t.label])),
};

/**
 * A document's name for display. Unknown values are de-underscored rather than
 * hidden: a row typed by some path we have forgotten should still read as
 * something, not vanish behind a fallback that claims it is a plain receipt.
 */
export function documentTypeLabel(type: string | null | undefined): string {
  if (!type) return "Document";
  return DOCUMENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

/** The dropdown's text for one option. */
export function documentTypePickerLabel(option: DocumentTypeOption): string {
  return option.pickerLabel ?? option.label;
}

export function isPickableDocumentType(type: string | null | undefined) {
  return !!type && DOCUMENT_TYPES.some((t) => t.value === type);
}
