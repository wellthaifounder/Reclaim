// Custodian list and submission instructions.
//
// Workstream E1: rescued from the legacy reimbursement path before it was
// deleted. The pages are gone but this is real content — the portal names and
// the menu labels a user actually has to find — and rewriting it from scratch
// later would be worse than moving it now.
//
// It belongs to E3, which produces the exportable claim packet: "custodian-
// specific submission instructions where known". "Where known" is the operative
// phrase — several custodians have no specific guidance here and fall through
// to the generic note, which is the honest answer rather than a guess at a menu
// path that may not exist.

/** Custodians offered in the picker, in the order the legacy flow listed them. */
export const HSA_CUSTODIANS = [
  "HSA Bank",
  "HealthEquity",
  "Fidelity HSA",
  "Optum Bank",
  "Lively",
  "WageWorks",
  "PayFlex",
  "Further",
  "Other",
] as const;

export type HsaCustodian = (typeof HSA_CUSTODIANS)[number];

const INSTRUCTIONS: Partial<Record<HsaCustodian, string>> = {
  "HSA Bank":
    'Submit this reimbursement package through your HSA Bank online portal at www.hsabank.com. Log in to your account, navigate to "Reimbursements" and upload this PDF along with any receipt images.',
  HealthEquity:
    'Log in to your HealthEquity account at www.healthequity.com. Click on "Reimburse Myself" and upload this PDF. Receipts may be required for verification.',
  "Fidelity HSA":
    'Access your Fidelity HSA account at www.fidelity.com/hsa. Select "Reimbursements" and follow the prompts to submit this documentation.',
  "Optum Bank":
    'Visit www.optumbank.com and log in to your account. Navigate to "Claims & Reimbursements" to submit this package.',
  Lively:
    'Log in at www.livelyme.com and select "Reimbursements" from your dashboard. Upload this PDF and any supporting receipts.',
};

const GENERIC =
  "Please contact your HSA provider for specific submission instructions. This package contains all the documentation a reimbursement request normally requires.";

/**
 * How to submit a claim to a given custodian.
 *
 * Falls back to the generic note for custodians with no verified guidance.
 * Inventing a menu path is worse than saying we do not have one — a user who
 * cannot find the screen we described stops trusting the rest of the packet.
 */
export function custodianSubmissionInstructions(
  custodian: string | null | undefined,
): string {
  if (!custodian) return GENERIC;
  return INSTRUCTIONS[custodian as HsaCustodian] ?? GENERIC;
}
