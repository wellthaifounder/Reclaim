# The Substantiate step — agreed specification

Settled with the founder on 2026-09-30 in a structured design session: competitor research
first, then three rounds of questions. This document is the reference for every future change
to the Substantiate dialog (`src/components/expense/SubstantiateDialog.tsx`), the panel it
shares with the full expense page (`SubstantiationPanel`, rendered by
`src/pages/BillDetail.tsx`), and the attach-and-scan flow behind both. **Where this document
and the current code disagree, this document is the intent and the code is the gap.**

The session was called after the founder tested the step and could not attach a document that
was already on the Documents page. The option existed only as a faint button on each queue
row, outside the dialog, and nowhere at all when the dialog was opened from the All tab, the
Review feed or the expense page. The same test showed the dialog explaining itself in the
wrong places — a rationale for the date of care, a "Still to add" box, the IRS rules told three
times — while the claimable amount sat three fields away from the payment it modifies.

This builds on Step 2 of `.claude/plans/bank-sync-workflow-spec.md`, and amends it in one
place (S9).

Decisions are numbered **S1–S35** so they cannot be confused with the transaction review
spec's D1–D46.

---

## 1. The model

**This is where the evidence meets the decision.** You see what you paid, attach what proves
it, and decide. Every field already holds a sensible value before you touch it; the work is
correcting the exceptions, not filling in a form.

**The bank's record is the anchor.** What was paid, and when, comes from the bank and is
never edited here. Documents supply what the bank cannot see: when the care happened, who it
was for, what was bought, and who the provider really is.

**Defaults are shown, not hidden.** Where the app already assumed something behind the scenes
— the payment date as the date of care, "Self" as the patient — that assumption becomes the
visible, editable starting value.

**The scan fills gaps; it never overwrites a person** (S9).

**Say nothing when all is well.** A message appears only when something needs attention,
beside the field it concerns. The one "all good" line kept is the IRS category the expense
qualifies under, because that is what the Medical Expense Record cites (S25).

**Paperwork never blocks, and the user is the approver.** A missing receipt never stops a
confirmation, and the user may confirm against the IRS list's judgement — but not against a
fact: care before the HSA opened, or a patient who is not a tax dependent.

---

## 2. Decisions

### 2.1 Getting a document on

| #   | Decision                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Choose from Documents** is a third option inside the dialog and on the full expense page, beside the upload and camera options. The queue row's separate "Use a file already on file" button is removed, leaving one "Attach a document" button per row. The bulk bar keeps "attach to all selected." |
| S2  | On phones the options read **Take a photo** (first and largest), **Choose from Documents**, **Upload a file**. On computers, **Upload a file** and **Choose from Documents** only.                                                                                                                      |
| S3  | The picker lists **likely matches first** — documents whose scanned amount and date line up with this charge — then everything else, newest first, with search and a thumbnail of each.                                                                                                                 |
| S4  | When a saved document clearly matches, the dialog offers it before the picker is opened: _"Looks like a match: [document] · Attach."_ It never attaches anything on its own.                                                                                                                            |
| S5  | **✕ on an attached document removes it from this expense only**, with Undo. A file is deleted for good only from the Documents page, which first warns and names every expense the file backs.                                                                                                          |
| S6  | Documents uploaded on the Documents page are **scanned at upload**, so they can be matched (S3, S4) and arrive pre-read when reused.                                                                                                                                                                    |

**On S1.** Three ways in, side by side, is how HSA administrators do it. WEX shows a card
charge that needs proof as an "Action Required" task, then offers the Receipt Organizer, the
camera, or the photo album. HealthEquity attaches a document to "a new or existing claim or
card transaction," or saves it "for later use." SAP Concur keeps uploaded-but-unattached
receipts in "Available Receipts" until they are used. Two buttons per row that did nearly the
same thing is how the founder missed the one that worked.

**On S2.** The product brief says camera-first on phones. On a computer the camera option's
`capture` attribute falls back to the same file picker as upload, so it was a duplicate
button. A QR-code hand-off to the phone's camera is deferred (§4).

**On S3, S4 and S6.** Expensify merges a scanned receipt into the card charge whose amount,
date and currency match; Ramp matches an emailed receipt when the amount matches plus the date
or the merchant. S4 borrows the idea and stops short of attaching: the app suggests, the user
decides — the same rule as the rest of the product.

**On S5.** Until now the ✕ deleted the `receipts` row outright, with no confirmation, and the
delete cascades through `receipt_invoices`, so the file vanished from every expense it backed
(`src/components/expense/ReceiptGallery.tsx:120-137`). Once reuse is easy, one hospital bill
will routinely back several instalments, and one misclick would unprove all of them.

### 2.2 The scan

| #   | Decision                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7  | The scan **runs by itself on every attach** — upload, photo, or a document chosen from the library — PDFs included. _"Reading your document…"_ shows while the user carries on.                                                                                                                                                                                     |
| S8  | Each document offers **Scan again**. A document the scan cannot read stays attached, marked _"Couldn't read this,"_ with Scan again beside it.                                                                                                                                                                                                                      |
| S9  | **The scan fills gaps; it never overwrites anything a person entered.** It writes directly into blank fields and fields still holding a default, marking each _"from your receipt."_ Editing a scanned value makes it the user's. Where a document disagrees with something the user entered, or with another attached document, the app asks rather than choosing. |
| S10 | Beyond today's fields, the scan reads the **full date range** of care (start and end), the **patient**, the **document type** (receipt, itemised statement, explanation of benefits, letter of medical necessity), and **what was bought or done**.                                                                                                                 |
| S11 | What the scan reads is **kept with the document**, so the IRS-category check can read it, a reused document fills the form without a second scan, and matching (S3, S4) has something to match on.                                                                                                                                                                  |
| S12 | The document's **provider name becomes the expense's name** everywhere — lists, search, and the Medical Expense Record. The bank's original text stays visible in small print in the top box.                                                                                                                                                                       |
| S13 | The total of all attached documents is compared with the payment, and **only a shortfall is flagged**: _"These documents cover $X of the $Y you paid. Is there another one?"_ A document larger than the payment is normal — a bill paid in instalments — and says nothing.                                                                                         |
| S14 | The scan never changes the Claiming amount.                                                                                                                                                                                                                                                                                                                         |

**On S9.** This amends the workflow spec, which said scan results were "suggestions the user
accepts, never silent overwrites." Filling a blank or a default overwrites nothing anyone
decided, and accepting each value one at a time was the friction the founder asked to remove.
The rule is Expensify's: values a person enters "are final and are not overwritten by the
scan," and "clearing a field hands it back" to the scan.

**On S10.**

- **Date range.** The scanner is told to use the _latest_ date of a range
  (`supabase/functions/_shared/receiptOcrProcessor.ts:70`), so a hospital stay that began
  before the HSA opened would pass the timing check on its last day.
- **Patient.** Needed on the record, and the only way the "You" default (S20) gets corrected
  without typing.
- **Document type.** Every upload from the dialog is hard-coded as `"receipt"`
  (`SubstantiateDialog.tsx:177`), so a letter of medical necessity uploaded there never clears
  the conditional expense waiting for it.
- **What was bought or done.** One of the five things proof must show (HealthEquity's list:
  patient, provider, date of service, type of service, cost), printed on the record, and what
  the category check needs. Without it, the check judged a $3.48 Walmart charge from the bank's
  category "Shops" alone.

**On S11.** Until now the dialog showed what the scan read and threw it away. `classify-expense`
reads `receipt_ocr_data` (`supabase/functions/classify-expense/index.ts:103-113`), which only
the inbound-email pipeline writes — so "Work out if this qualifies" never saw a receipt
uploaded in the dialog.

**On S12.** Bank text reads like "SQ \*SMILE DENTAL 8842"; the document says "Smile Dental
Group." The old "Use these" rewrote `invoices.vendor` inside a box labelled "From your bank."
Keeping the bank's text visible means nothing is lost — it is the link back to the statement.

**On S13.** A matching amount is the strongest sign the right document is attached. Flagging a
shortfall catches both the wrong receipt and the half-documented payment; flagging an excess
would nag every payment plan.

### 2.3 The fields

| #   | Decision                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S15 | The top box shows the provider (S12), _"Paid [date]"_ and the amount, then **Claiming**: an editable field, pre-filled with the full amount. Lowering it shows _"$X won't be claimed."_ It cannot exceed what was paid. No "Change" link, no hint text.            |
| S16 | For a charge paid with the HSA card (claim state `not_reimbursable`), Claiming is replaced by one line: _"Paid from your HSA, so there's nothing to reimburse."_                                                                                                   |
| S17 | Mileage entries keep their miles × rate working in the top box, and never show the amber label.                                                                                                                                                                    |
| S18 | **Date of care is pre-filled with the payment date.** A date or range read from an attached document replaces the pre-fill (S9). A typed date is never replaced.                                                                                                   |
| S19 | While the date is still the pre-fill and the charge was paid **within 90 days after the HSA opened**, one line appears under it: _"Care before [opening date] can't be reimbursed. Check the date on the bill."_ The date of care is explained nowhere else.       |
| S20 | **"Who was it for?"** is the existing family dropdown with **You** pre-selected, and no "Change" link. The scan switches it when a document names a family member, unless the user picked someone; a name not on the family list is shown with a link to add them. |
| S21 | Tags stay **visible at the bottom** of the dialog — not collapsed behind "More."                                                                                                                                                                                   |
| S22 | Every field **saves as it changes**, confirmed by a small _"Saved."_ There are no per-field Save buttons.                                                                                                                                                          |

**On S15, S20 and S21.** All three are the founder's calls, over a recommended "Claiming $3.48
· Change" line, a "For: You · Change" link, and tags tucked under "More." A visible,
pre-filled control already says it can be changed; a link or a fold that reveals it only adds
a step.

**On S16.** The IRS can ask about any HSA spending, so these still need proof; but the HSA
already paid, so nothing can be reimbursed. `approval_creates_expense` gives HSA-card charges
the claim state `not_reimbursable`, yet the dialog asked "How much can you claim?" of them
anyway.

**On S17.** For a mileage claim the working _is_ the proof — there is no receipt to chase — so
it is not one of the hints S29 retires.

**On S18.** The app already treated a blank date of care as the payment date:
`invoices.effective_service_date` is `COALESCE(service_date, date)`
(`supabase/migrations/20260816160000_timing_gate.sql:51-52`), and both the eligibility checks
and the Medical Expense Record read it. S18 shows the assumption instead of hiding it. For
pharmacy and store purchases it is simply correct: HealthEquity defines the date of service as
when care was provided "or the item was purchased."

**On S19.** The one case where the pre-fill is dangerous: care received before the HSA opened
and paid after it. The IRS never allows that, and the pre-fill would make it look eligible.
Once a document or the user supplies the date, the line goes.

**On S20.** Another hidden default made visible: the record already printed "Self" for a blank
patient (`src/lib/substantiationRecord.ts:314`, `src/lib/claimPacket.ts:269`).

**On S22.** The dialog promised "everything saves as you go," but the date and the amount each
had their own Save button, and a value typed without pressing it was lost when the dialog
closed.

### 2.4 Messages

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S23 | Eligibility checks report **problems only**; a passing check says nothing. Each problem sits beside the field it concerns: care before the HSA opened under the date of care; a patient who isn't a tax dependent under "Who was it for?"; IRS-category problems (not allowed, or needs a letter of medical necessity) beside Documents.                                  |
| S24 | The IRS-category check **runs by itself after each scan**, reading what the document says was bought. The "Work out if this qualifies" button is retired.                                                                                                                                                                                                                 |
| S25 | When the expense qualifies, one neutral line near Confirm names the category — _"Over-the-counter medicine (IRS Publication 502)."_                                                                                                                                                                                                                                       |
| S26 | An **amber label** sits just above the attach options until proper proof is attached: _"Needs a receipt or itemised bill,"_ with **What counts?** and **I don't have one** beside it.                                                                                                                                                                                     |
| S27 | **What counts?** opens a short list of what proof should show: patient, provider, date of care, what was done, and cost. This is where the IRS explanation now lives.                                                                                                                                                                                                     |
| S28 | When the only document is a bare card slip — the scan finds nothing about what was bought — the label stays, reworded: _"This looks like a card slip. An itemised receipt shows what was bought."_ It goes when an itemised document is attached.                                                                                                                         |
| S29 | **Retired:** the "Still to add" box; the lines for checks that passed, including _"This is after your HSA was opened…"_; the grey note under Documents; the "What the IRS would want to see" box; the hints under the date, amount and tags fields; _"From your bank, so it can't be edited here"_; the "Nothing attached" badge; the description under the dialog title. |

**On S23.** The old box listed all three checks, passing ones included, in one alert at the
top of the panel — which is where the date-of-care paragraph the founder found disruptive came
from. Beside the field, the fix sits next to the problem.

**On S24 and S25.** The check was a button because it costs an AI call and was only worth
running once documents existed (Workstream D4). S7 makes the moment a document arrives the
moment to run it. S25 is the one "all good" line S23 allows: the category is what the Medical
Expense Record cites as the reason the expense qualifies, so the user should see it before
pressing Confirm.

**On S26–S28.** The founder's design: a small amber label that goes away once a document is
attached. S28 refines "a document" to "proper proof," because a card slip alone usually isn't
enough for the IRS — the app's own retired copy said so — and S10's "what was bought" is how
the scan tells the difference.

**On S29.** "From your bank…" was also wrong for cash and mileage entries, which never came
from a bank.

### 2.5 The decision

| #   | Decision                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S30 | The dialog's footer carries the decision: **Confirm eligible** (main button) and **Not eligible**. Closing without deciding keeps everything entered, and the expense stays in the queue.                                              |
| S31 | Opened from the Substantiate queue, either button saves and **moves straight to the next expense**, with a count (_"3 of 12"_). Opened anywhere else, it closes.                                                                       |
| S32 | When the IRS list says a category is not allowed, Confirm stays available with one extra step — _"The IRS list says this usually isn't allowed. Confirm anyway?"_ — and the record notes it was the user's judgement against the list. |
| S33 | When the care predates the HSA, or the patient isn't a tax dependent, **Confirm is not offered** until that fact is corrected: the date, or the family list.                                                                           |
| S34 | **I don't have one** takes the expense out of the queue, and the Medical Expense Record says plainly _"No receipt, bank record only."_ Attaching a document later clears it. Confirming with no document attached stays allowed.       |

**On S30.** The decision lived only on the queue row, so the dialog opened from the All tab or
the Review feed had no way to confirm at all.

**On S31.** Working through a backlog is what the queue is for; one button means no extra
choice.

**On S32.** The queue row greyed out Confirm for a rule-ineligible expense while the text
beside it said the user could override
(`src/components/expense/SubstantiateQueue.tsx:503-538`). The founder ruled on 2026-09-17 that
an action offered anywhere is offered everywhere, and Gate 3 is judgement:
`recompute_expense_eligibility` already lets a user's confirmation outrank it.

**On S33.** Gates 1 and 2 are facts. `recompute_expense_eligibility` re-applies a factual
refusal even to a confirmed expense
(`supabase/migrations/20260905120000_receipt_invoices_join_table.sql:438-444`), so a Confirm
button there would only look like it worked.

**On S34.** A confirmed expense with no document stayed in `needs_receipt` indefinitely, so one
lost receipt meant the queue could never reach zero. This is Ramp's "I don't have a receipt"
without a finance team to approve it, and the record stays honest about what backs the claim.

### 2.6 Surfaces

| #   | Decision                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S35 | The dialog is one component wherever it opens — the queue, the All tab, the Review feed — and the full expense page (`BillDetail`) changes alongside it in every slice. The two share `SubstantiationPanel` and must not drift apart. |

---

## 3. Gap list — this spec versus what is built

**Build status:** slice 1 is built (1a: S1, S2, S5; 1b: S15–S23, S26, S27, S29, S35, and the
faults below). Slices 2–4 are not. Beyond the decisions themselves, the session found these
faults in the current code. Each is fixed in slice 1 unless marked otherwise.

Slice 1b notes, for whoever builds the slices that follow:

- **"I don't have one"** is part of S26 but belongs to slice 2 (S34); the amber label ships
  with **What counts?** alone, and "proper proof" is for now any attached document (S28 needs
  the scan).
- **"Work out if this qualifies"** stays as a quiet button beside Documents until slice 3 runs
  the category check by itself (S24); retiring it earlier would leave an unchecked expense with
  no way to ask.
- **The unlinked "Self"** was not traced to a writer — nothing in `src/`, the edge functions or
  the migrations writes `'Self'` without a `patient_id`, so it is most likely old rows from
  before the roster. The panel now **writes** "You" (the account holder's roster row) the first
  time it opens an expense with no patient, so every expense opened is repaired and the
  dependency check reads the same answer the field shows. Expenses nobody has opened are not
  touched; a catch-up migration was left out because one locked row would abort the whole
  statement.

- **"Tell us who Self is so we can check whether their expenses qualify."** Some expenses carry
  `patient_name = 'Self'` with no `patient_id`, and `expense_dependency_gate`
  (`supabase/migrations/20260816140000_family_roster.sql:340-349`) cannot tell that "Self" is
  the account holder. The path that writes the unlinked "Self" was not pinned down in the
  session.
- **A doubled icon** in the eligibility box: the alert's own icon renders beside each row's
  icon (`src/components/hsa/EligibilityGates.tsx`).
- **The date of care can be set in two places:** the eligibility box's "Set the date of care"
  editor and the panel's "When was the care?" field.
- **A typed date or amount is lost** if the dialog closes before that field's own Save (S22).
- **✕ deletes a shared document everywhere**, with no confirmation, and leaves its file in
  storage (S5).
- **HSA-card charges are asked "How much can you claim?"** (S16).
- **The scanner reads only the first image of an upload**, never a PDF (S7), and its output is
  discarded (S11). _Slice 3._
- **Every upload from the dialog is labelled "receipt"** (S10). _Slice 3._
- **Accepting a scan rewrites the bank's name** in a box labelled "From your bank" (S12).
  _Slice 3._

### Build order

Four slices, each about one working session, each shipped on its own. Where a slice needs a
database change, the migration is applied to production before the code merges.

| Slice                     | What it delivers                                                                                                                                                                                                                                                                                                                                     | Decisions                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Documents and layout   | Choose from Documents (a plain list for now); ✕ removes from this expense, with Undo; the Documents-page delete warning; the new top box; the date pre-fill and its 90-day line; "You" pre-selected; problems beside their field; the retired text; the amber label and What counts?; saving as you go; phone and computer options; the faults above | S1, S2, S5, S15–S23, S26, S27, S29, S35                         |
| 2. Deciding in the dialog | Confirm / Not eligible in the footer; the next expense from the queue; Confirm anyway?; I don't have one                                                                                                                                                                                                                                             | S30–S34                                                         |
| 3. The scan               | Scans on every attach, PDFs included, with results kept; the new fields and their markers; Scan again; the provider name; the shortfall flag; the category check after each scan and its line; the card-slip wording                                                                                                                                 | S7–S14, S24, S25, S28, and the scan-driven parts of S18 and S20 |
| 4. Matching               | Scanning Documents-page uploads; likely matches first in the picker; Looks like a match                                                                                                                                                                                                                                                              | S3, S4, S6                                                      |

Slice 1 fixes everything the founder hit and needs no AI changes. The scan changes the database
and the AI step, so it goes in once the layout it fills is in place. Matching needs documents
that have already been scanned, so it comes last.

---

## 4. Deliberately not in this spec

- **Handing a photo off from a computer to a phone by QR code** (Tripl does this). Useful, but
  a bigger build than anything here; S2 simply drops the duplicate camera option on computers
  until then.
- **Attaching a matched document automatically.** S4 suggests; the user decides.
- **Editing what was paid, or when, from the dialog.** The bank's record is the anchor (§1).

---

## 5. The research this rests on

Gathered 2026-09-30. Claims quoted above come from these pages.

- **HSA Tracker Pro** — the founder's named reference. Receipt-first, with no bank connection
  (per a third-party comparison). AI fills provider, date, amount and category from a photo or
  PDF, flags eligibility, and records both the date of service and the date paid. Its public
  pages do not show whether scanned values are reviewed before saving.
  [How it works](https://hsatrackerpro.com/how-it-works) ·
  [Features](https://hsatrackerpro.com/features) ·
  [App Store](https://apps.apple.com/us/app/hsa-tracker-pro/id6759116912) ·
  [Comparison](https://www.hsatrackr.com/guides/best-hsa-trackers-2026)
- **WEX** — "Action Required" tasks; add a receipt from the Receipt Organizer, the camera, or
  the photo album. [Mobile app guide](https://newtools.cira.state.tx.us/upload/page/6814/Mobile%20App%20Guide.pdf)
- **HealthEquity** — attach to a new or existing claim or card transaction, or save for later;
  the five elements of proof; date of service includes the purchase date.
  [Upload a receipt](https://support.healthequity.com/app/answers/detail/a_id/1341/~/upload-a-receipt-to-the-mobile-app) ·
  [Receipt requirements](https://help.healthequity.com/en/articles/5053750-fsa-receipts-and-payment-options-ez-receipts)
- **Lively** — up to four images per expense, replaceable at any time.
  [Multiple receipt upload](https://support.livelyme.com/hc/en-us/articles/360001686792-What-is-Multiple-Receipt-Upload)
- **Expensify** — automatic receipt-to-card-charge merging; typed values are final.
  [Preventing duplicates](https://help.expensify.com/articles/expensify-classic/expenses/How-to-prevent-duplicate-expenses) ·
  [Merging expenses](https://help.expensify.com/articles/new-expensify/reports-and-expenses/Merging-expenses) ·
  [Scan-entry rule](https://github.com/Expensify/App/pull/101136)
- **Ramp** — matching on amount plus date or merchant; "I don't have a receipt."
  [Missing receipts](https://support.ramp.com/hc/en-us/articles/1500011601642-What-to-do-if-you-re-missing-a-receipt) ·
  [Receipt forwarding](https://support.ramp.com/hc/en-us/articles/360047979213-How-to-automatically-forward-receipts-to-Ramp)
- **SAP Concur** — "Available Receipts."
  [Attach receipts](https://help.sap.com/docs/concur-expense/concur-expense-standard-edition-tools-guides/attach-receipts?locale=en-US)
- **Tripl, HSA Vault, Reimbursable** — AI reading of photos and PDFs; Tripl's QR hand-off;
  Reimbursable's Plaid bank sync, the closest model to this product's.
  [Tripl](https://triplapp.com/hsa-receipt-tracker) ·
  [HSA Vault](https://hsavault.app/blog/best-hsa-tracking-apps) ·
  [Reimbursable](https://www.reimbursable.com/blog/10-best-digital-receipt-apps-2024/)

---

_Agreed 2026-09-30. Slice 1 is built; start at slice 2._
