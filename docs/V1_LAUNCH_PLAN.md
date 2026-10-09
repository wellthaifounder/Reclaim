# Reclaim v1 — launch plan

Agreed with the founder on 2026-10-08. It started from an outside browser audit of the live app
(run by Grok). Every finding was checked against the code before anything went into this plan:
several were real, several were misdiagnosed, and one bug the audit never saw turned up along the
way (Batch 0). **Where this document and the code disagree, this document is the intent and the
code is the gap.**

**Amended 2026-10-09.** The founder approved a change of positioning: Reclaim leads with the
shoebox approach (pay out of pocket, let the HSA grow, reimburse later) and setup starts with a
receipt, not a bank. That added decisions L13–L18 and Batches 1b and 8, changed L5, L7, L9 and L12,
and reverses Step 0 of `.claude/plans/bank-sync-workflow-spec.md`.

Decisions are numbered **L1–L18** so they cannot be confused with the transaction review spec's
D-numbers or the Substantiate spec's S-numbers. Cite them in code comments.

Each batch is sized for one working session, ends in its own pull request, and is shown working
in the browser (light and dark, desktop and phone) before it merges. Build them in order.

---

## 1. The short version

The middle of the app is solid: proving an expense qualifies, the claim export, the double-claim
lock and mileage all worked under audit. What breaks is the **start** (signup and setup) and the
**end** (what happens after a claim is sent). Those are where a new user gets lost or stops trusting
the numbers. Separately, bank sync has been fetching only 90 days of history instead of two years,
and the paid plans unlock nothing.

| #   | Batch                        | What a user gets                                                                        |
| --- | ---------------------------- | --------------------------------------------------------------------------------------- |
| 0   | Full bank history            | Connecting a bank finds up to two years of spending, not three months                   |
| 1   | Setup works                  | Setup finishes instead of looping; one HSA date everywhere; dates show the right day    |
| 1b  | Receipt-first setup          | Setup starts with a first receipt; the bank is optional and comes last                  |
| 2   | Claims can finish            | An "I got paid" button; every screen agrees on where a claim stands                     |
| 3   | Signup and save errors       | Clear errors next to the field; a real "check your email" screen                        |
| 4   | Every expense gets checked   | Nothing is confirmed without its IRS-category check, or at the billed amount by mistake |
| 5   | Copy and pricing consistency | Every screen describes the product and the plans the same, true way                     |
| 6   | Paid plans                   | Checkout works; bank sync, claims and exports are paid; a free look-back sells it       |
| 7   | Backfill for older years     | Years of old receipts become expenses without typing each one in                        |
| 8   | Landing page                 | The shoebox pitch up front, with real screenshots of the record and the export          |

Waiting on the domain and brand decision (deferred since 2026-09-08), so **not** in any batch:
auth emails sent from your own domain with Reclaim branding, and the contact address on the Privacy
and Terms pages (currently the founder's Gmail). The landing page no longer waits: its positioning
is decided (L13) and only the address it lives at is open.

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Ask Plaid for the full history.** Every new bank connection requests 730 days, the most Plaid allows. Copy says "up to two years, depending on your bank".                                                                                                                                                                                                                                                                                                                             |
| L2  | **One HSA opening date.** `profiles.hsa_opened_date` is the date that counts. Onboarding, the Settings profile field and the Settings HSA-account form all write it.                                                                                                                                                                                                                                                                                                                     |
| L3  | **"I got paid" closes a claim by hand.** It shows the claim total, pre-filled and editable. If less arrived, the shortfall goes back to "ready to claim". Deposit matching from a connected bank stays and is offered first.                                                                                                                                                                                                                                                             |
| L4  | **Paid:** ongoing bank sync, the claim packet, the yearly Medical Expense Record, the tax export, and any other finished deliverable.                                                                                                                                                                                                                                                                                                                                                    |
| L5  | **Free one-time bank look-back.** A free user connects a bank, Reclaim pulls the history and shows "We found N likely medical charges, $X". Keeping the connection syncing, and acting on what was found, is paid. Offered as the last, optional step of setup (L14) and from Settings.                                                                                                                                                                                                  |
| L6  | **Your own records are always yours.** Downloading your own documents and a plain list of your expenses is free forever, including after cancelling. Only the finished deliverables are paid.                                                                                                                                                                                                                                                                                            |
| L7  | **Annual billing.** Monthly and annual prices. A free user can keep adding expenses indefinitely, and documents up to the free limit (L16), and pays when they want a deliverable or more room.                                                                                                                                                                                                                                                                                          |
| L8  | **One paid plan.** Free and one paid plan. Premium is withdrawn until it has real features: priority support, custom reports and API access are advertised and none exist.                                                                                                                                                                                                                                                                                                               |
| L9  | **Free AI reads have a monthly allowance.** Receipt reading and the eligibility check each cost an AI call; free accounts get a monthly allowance, paid accounts are unlimited. For a free account the 10-document limit (L16) bounds this in practice.                                                                                                                                                                                                                                  |
| L10 | **Checkout is fixed before anything is locked**, or nobody can pay.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L11 | **The paywall is enforced on the server.** The claim packet is built in the browser today, so hiding a button would stop no one.                                                                                                                                                                                                                                                                                                                                                         |
| L12 | **Older years come from documents.** Bank history ends at about two years, but HSA claims have no deadline. Uploaded documents that match no existing expense become draft expenses the user confirms. Offered wherever the HSA opened before the earliest expense on file.                                                                                                                                                                                                              |
| L13 | **Lead with the shoebox approach.** The pitch is long-term, audit-ready records for people who pay out of pocket and reimburse later. Finding what was already paid is the supporting line. Headline direction: "Pay now. Reimburse yourself anytime. Keep IRS-ready records the whole way." Supporting: "We'll also find what you've already paid." Two audiences: people who already shoebox (worry-free records) and people learning it (a short explanation and an easy first step). |
| L14 | **Setup starts with a receipt.** The first step is "Add your first receipt". Connecting a bank is optional, comes last, and is framed as finding what was already paid. This reverses Step 0 of the workflow spec ("Connect first, configure second").                                                                                                                                                                                                                                   |
| L15 | **The first setup question sets the dashboard's view.** "I already save receipts to claim later" and "I'm new to this" both select the shoebox view; "I reimburse as I go" selects the regular view. "New to this" gets one short screen explaining the approach, with a growth example calculated from `regulatoryLimits.ts` and labelled as an illustration. Changeable in Settings at any time. (Partly restores the question removed from setup on 2026-08-30.)                      |
| L16 | **A free account stores up to 10 documents.** Past that, adding more needs the paid plan. Nothing is ever deleted, and downloading stays free (L6). Expenses without a document (mileage, bank charges) are not counted.                                                                                                                                                                                                                                                                 |
| L17 | **The landing page shows proof.** Screenshots of a finished expense record (the eligibility check with its IRS Publication 502 citation) and of the export package (README, PDF, spreadsheet, receipts), taken from a demo account with made-up data. A section on the expenses insurance never sees (drugstore purchases, glasses and contacts, over-the-counter medicine, mileage, cash-pay visits) pointing to receipt reading and "Driving to care".                                 |
| L18 | **Guard against claiming the billed amount.** An expense entered from a receipt has no bank payment behind it, so nothing shows what was paid after insurance. When the document read shows an insurance payment or adjustment, a problem appears beside Claiming: claim only what you paid yourself. Reported as a problem only, beside its field (S23). Not the same as S13, which flags documents that cover less than the payment.                                                   |

---

## 3. The batches

### Batch 0 — Full bank history (L1)

**What's wrong.** `plaid-create-link-token` never sets `transactions.days_requested`, so every
connection gets Plaid's default of 90 days. Setup promises "up to 18 months" and the landing page
says "two years"; neither is true today. The `lookbackDays: 550` values in `plaid-sync-transactions`
and `plaid-webhook` only widen a database sweep — they never ask Plaid for more.

Plaid fixes the amount of history when a bank is first connected, and it cannot be raised
afterwards. An existing connection must be removed and connected again.

**Build.**

- Add `transactions: { days_requested: 730 }` to the `/link/token/create` body
  (`supabase/functions/plaid-create-link-token/index.ts`).
- Raise the two 550-day sweeps to match (`plaid-sync-transactions/index.ts:321`,
  `plaid-webhook/index.ts:233`), and correct the "18-month backfill" comments.
- Copy: `src/pages/Welcome.tsx` ("up to 18 months") and `src/components/HowItWorks.tsx`
  ("two years") both become "up to two years, depending on your bank".
- The founder reconnects his own bank afterwards.

**Done when.** A new sandbox connection returns transactions older than 90 days, and both
screens say the same thing.

### Batch 1 — Setup works (L2)

**What's wrong.**

1. **Setup loops back to the start.** The dashboard sends anyone whose setup is unfinished to
   `/welcome`. Finishing setup marks the saved status stale, but nothing on the setup page is
   watching it, so the dashboard opens with the copy saved before setup and bounces the user back.
   It happens to anyone who finishes within about five minutes of first arriving (the default cache
   lifetime); slower users escape, which is why "I'll find it later" seemed to work.
   (`src/hooks/useOnboardingStatus.ts`, `src/pages/Dashboard.tsx:111`)
2. **Two HSA dates.** Onboarding writes `profiles.hsa_opened_date`. The HSA-account form in
   Settings writes `hsa_accounts.opened_date`. The checklist and the eligibility rule read only the
   first, so adding an account in Settings never satisfies them.
3. **Dates shown a day early.** Stored correctly, but a few places read `"2022-03-15"` as midnight
   UTC, which is the evening before in every US time zone: `src/lib/hsaAccountUtils.ts` (lines 32,
   77, 83) and `src/components/hsa/HSAAccountSelector.tsx:39-41`. Mileage defaults to tomorrow
   after early evening for the same reason (`src/components/expense/MileageEntryForm.tsx:52`).
4. **The HSA date box looks dead.** It only takes the date when you click away, so after autofill
   Continue stays greyed out (`src/components/ui/date-field.tsx`).
5. **The install pop-up appears mid-setup** — `/welcome` and `/onboarding/import` are missing from
   its suppressed list (`src/components/PWAInstallPrompt.tsx:25`).
6. On the household step, **Continue and "It's just me" do the same thing.**

**Build.**

- Write the completed status into the cache (or wait for the refetch) before navigating away
  from setup.
- Saving an HSA account updates `profiles.hsa_opened_date` to the earliest opening date across the
  user's HSA accounts, then recalculates the timing rule. (A later HSA funded by rolling over an
  earlier one counts as opened on the earlier date, so earliest is the right default.)
- Use `parseDateOnly` / `formatDateOnly` from `src/lib/dates.ts` at the spots above, and
  `toLocalISODate` from `src/lib/utils.ts` for mileage.
- The date box takes the date as soon as the typed text is a complete, valid date.
- Add the two setup routes to the pop-up's suppressed list.
- The household step gets one button whose wording depends on whether anyone was added.

**Done when.** A fresh account goes from signup through setup to the dashboard with no loop; a date
entered anywhere shows the same day everywhere; the checklist reaches 100% whichever screen the
date was entered on.

### Batch 1b — Receipt-first setup (L14, L15)

**Why.** Setup opens by asking for bank credentials, which is the largest trust hurdle in the
product and is now a paid feature (L4). The product's pitch is the shoebox (L13), and the first
thing a shoebox holder does is put a receipt in it.

**Build.** Batch 1's fixes land first, in the current flow; this batch then reorders it
(`src/pages/Welcome.tsx`).

1. **One question:** "I already save receipts to claim later" / "I'm new to this" / "I reimburse
   as I go". Sets `reimbursement_strategy_preference` (L15).
2. **For "new to this" only:** one short screen on how the shoebox works, with a growth example
   calculated from `regulatoryLimits.ts` (never a typed-in IRS figure; the 2026-09-19 lesson) and
   labelled as an illustration, not a forecast.
3. **Add your first receipt:** camera or file, read by the scan, confirmed by the user. Skippable.
4. **Household**, then **HSA opening date**, both unchanged.
5. **Optional, last:** "Find what you've already paid" is the bank connection with the free
   look-back (L5). `/onboarding/import` keeps its focused layout when reached from here.

Also in this batch: amend CLAUDE.md's `<FocusedLayout>` section. It says the top bar's "Snap a
receipt" button competes with the one screen arguing for a bank; that reasoning is now reversed.
The layout rules themselves (setup only, always a way out, exiting completes setup) stand.

**Done when.** A fresh account can finish setup having added one receipt and never been asked for
bank credentials; the dashboard opens in the view the first answer chose; skipping at any step
still completes setup.

### Batch 2 — Claims can finish (L3)

**What's wrong.** After a claim is sent, "In a claim" on Expenses and "Submitted" on the dashboard
are both correct. The real problems:

1. **The Reimburse page mislabels expenses in a sent claim.** It counts everything in the year's
   record that is no longer claimable and calls the difference "already paid from the HSA". A sent
   claim's expenses fall into that difference (`src/pages/Substantiation.tsx:1841`).
2. **The menu badge goes stale.** It caches for five minutes and nothing refreshes it when a claim
   is marked sent, so it keeps showing "ready" (`src/hooks/useAttentionItems.ts`).
3. **A claim can never finish without a bank.** A sent claim closes only when a deposit from a
   connected bank is matched and confirmed (`confirm_deposit_match`). Anyone without a bank has no
   way to say "I got paid".

**Build.**

- Split the Reimburse page's sentence: "N in a claim you've sent" versus "N paid with the HSA
  card".
- After marking a claim sent, and after closing one, refresh the badge, the dashboard and the
  expense lists.
- New database function to close a sent claim by hand: takes the amount received, defaulting to
  the claim total. It applies the money to each expense the same way `confirm_deposit_match` does;
  if the amount is short, the shortfall is spread back so those expenses become claimable again.
  Runs as one transaction, like the existing function. **Migration — apply to production before
  merging.**
- "I got paid" on each sent claim on the Reimburse page. When a matched deposit is waiting, that
  match is offered first.
- The dashboard's "Track" button opens the Reimburse page scrolled to the sent claims.

**Done when.** Send a claim, then mark it paid in full and (separately) short: the badge, dashboard,
Expenses and Reimburse page all agree at every step, and the short case returns the remainder to
"ready to claim".

### Batch 3 — Signup and save errors

**Reproduce first.** Three audit reports do not match what the code does, and need watching in a
browser before anything is changed:

- **"Saving an expense with no patient fails."** Patient cannot be left blank on that form — it
  defaults to you, and every new account gets a "Me" entry. Something else made that save fail.
- **"A rejected email clears the signup form."** The form only clears after a _successful_ signup.
- **"Upgrade doesn't jump to the plan section."** The jump logic exists (`Settings.tsx`, `#plan`).

**Build.**

- A proper "Check your email" screen after signup, naming the address, with a resend button —
  replacing a pop-up over an emptied form (`src/pages/Auth.tsx:250`).
- Errors shown next to the field they concern, on signup and on the expense form, instead of only
  in a pop-up.
- "Failed to save expense. Please try again." says what actually went wrong when it is something
  the user can fix (`src/pages/ExpenseEntry.tsx:398`).
- Whatever the three reproductions turn up.

### Batch 4 — Every expense gets checked (L18)

**What's wrong.** The IRS-category check runs by itself whenever a document is read (S24). An
expense with no document, or one entered through the "add an expense" form (which uses the older
`process-receipt-ocr` reader), never gets it. Confirming one exports it as "unclassified — review
required" with no warning.

**Build.** When Confirm is pressed and no check has run, run it first. The user still decides:
if the check says no, the existing "Confirm anyway?" question appears. If the check itself fails,
say so and let them confirm unclassified knowingly.

**Also (L18).** With setup now starting from receipts, more expenses will have no bank payment
behind them. A provider's bill shows what was charged, not what the patient paid after insurance.
When the scan finds an insurance payment or adjustment on the document, show a problem beside
Claiming so the user claims only their own share. Retail receipts (a pharmacy, an optician) show
what was paid and raise nothing.

### Batch 5 — Copy and pricing consistency (L4, L8)

Make every screen describe the product and the plans the same, true way. Written to match Batch 6.

- **Positioning (L13):** wording inside the app that frames Reclaim as a one-time recovery tool
  moves to the shoebox framing, including the dashboard's empty state and "Snap a receipt" as the
  first action. The landing page itself is Batch 8.

- **Plans:** one name for the free plan everywhere ("Starter" in Settings and Pricing, "Free Plan"
  in the sidebar); drop the claim that receipt reading is paid; replace the unenforced "up to 50
  expenses" with the 10-document limit (L16); remove Premium (L8); replace "14-day free trial" with the free look-back (L5); show
  annual pricing (L7). (`src/components/Pricing.tsx`,
  `src/components/settings/SubscriptionManagement.tsx`, `src/components/AppSidebar.tsx`,
  `src/components/subscription/UpgradePrompt.tsx`)
- **Guide:** "They're all reimbursable" overstates eligibility — rewrite (`src/pages/Guide.tsx`
  ~line 345). "Generate a reimbursement PDF" — the download is a package (PDF, spreadsheet,
  receipts); say so.
- **Dashboard:** a brand-new, empty account should not say "You're all caught up" — show a
  first-step prompt instead. "Snap a receipt" should open the camera, not the same form as "Log an
  expense". The setup bar's "One More Step" label sits beside two items; fix the wording.
- **Settings:** remove "Notification preferences coming soon".
- **Smaller:** "a cheque" → "a check" (`ExpenseEntry.tsx:453`); look for stray "--" in visible
  text; Documents icons get labels; receipts filed as "Bill" get the right type.

### Batch 6 — Paid plans (L4–L11)

**What's wrong.** Nothing in the app is locked. Paid plans unlock nothing, and checkout itself
failed in September for a reason still unknown.

**Build, in this order.**

1. **Fix checkout (L10).** One real Upgrade click in production, then read the logged reference
   to find which step failed. Suspects: the Stripe secret key, or the two price ids not existing
   in that Stripe account.
2. **One paid plan, monthly and annual (L7, L8).** New Stripe prices; `create-checkout` and
   `check-subscription` updated.
3. **Server-side locks (L11):**
   - Bank: the link-token function allows a connection if the user is paid, or has not used the
     free look-back yet. Ongoing syncs run only for paid users.
   - Deliverables: creating a claim or a record (`substantiation_records`) is refused by the
     database for free users. The browser only builds the file after that row exists.
4. **Free look-back (L5).** A free user's first connection pulls the full history and shows the
   found total with an upgrade offer. Record that the look-back was used; then remove the Plaid
   connection so it stops costing money. Found expenses stay. Upgrading reconnects.
5. **Always yours (L6).** "Download my documents and expense list" in Settings, free, and still
   available after cancelling.
6. **AI allowance (L9).** Count reads for free accounts; at the limit, explain and offer the
   upgrade.
7. **Document limit (L16).** A free account's eleventh document is refused on the server with an
   upgrade offer. Existing documents stay viewable and downloadable. Nothing is deleted on
   downgrade or cancellation.

**Done when.** A free account can connect once, sees its total, cannot generate a claim or record
or store an eleventh document (and cannot get round any of these by calling the database
directly), can always download its own files;
a paid test account can do everything; checkout succeeds end to end with Stripe's test mode.

### Batch 7 — Backfill for older years (L12)

**Why.** HSA claims have no deadline: someone who opened their HSA in 2016 can still claim 2016
care, but no bank connection reaches back that far. For those years, receipts and bills are the
only evidence. Today an uploaded document can only attach to an expense that already exists, so a
long-time HSA holder would have to type every old expense in by hand first. This was deferred to
v1.1 on 2026-08-12; it is now a launch need.

**Build.**

- Documents that match no existing expense become **draft** expenses, filled from what the scan
  read (amount, date, provider, patient). Nothing is confirmed by the app — the user reviews and
  confirms each one, as everywhere else.
- The existing match rules (`src/lib/documentMatch.ts`) run first, so a document for a charge the
  bank already delivered attaches to it rather than creating a duplicate.
- On the dashboard after setup: if the HSA opened before the earliest expense on file, offer
  "Your HSA opened in 2016. Have receipts from before 2024? Upload them.", leading to bulk upload.
- A free account's backfill stops at the 10-document limit (L16), so a real backfill is a reason
  to upgrade.

**Later, not v1:** importing old bank statements (most banks let you download them as a
spreadsheet) to recover what was actually paid in years Plaid cannot reach.

### Batch 8 — Landing page (L13, L17)

Built last so the screenshots and the pricing section show finished features.

- **Headline and supporting line** per L13, replacing "Connect your bank and Reclaim finds what
  you already paid for" (`src/components/Hero.tsx`).
- **How it works** rewritten around the shoebox: add a receipt, Reclaim checks it and keeps the
  record, reimburse whenever you choose (`src/components/HowItWorks.tsx`).
- **"The receipts insurance never sees are the ones you lose."** Drugstore purchases, glasses and
  contacts, over-the-counter medicine, mileage to appointments, cash-pay visits, pointing to
  receipt reading and "Driving to care".
- **Screenshots** of a finished expense record and of the export package, from a demo account
  holding made-up data only. Light and dark.
- **Pricing section** matches Batch 6: free with 10 documents, one paid plan.
- Tighten the spacing the audit read as blank gaps.

Wording to keep honest: "IRS-ready" describes the records, not an IRS endorsement; "reimburse
yourself anytime" holds only for care received after the HSA was opened.

---

## 4. Open details

Small enough to settle inside the batch that needs them:

- Monthly and annual prices for the one paid plan (Batch 6). Today's paid price is $9.99/month and
  the pricing page advertises 20% off annually.
- The free AI allowance — how many reads a month (Batch 6).
- Whether the free look-back keeps the connection open for a short grace period before removing
  it, rather than removing it at once (Batch 6).

## 5. Checked and set aside

Audit findings that turned out not to need work:

- **"Store dates as plain calendar dates everywhere."** They already are; the problem was a few
  display spots (Batch 1).
- **"Give each expense one status after a claim."** The status design is sound; the real faults
  are the three in Batch 2.
- **Guide contribution limits hard-coded.** Already calculated from `regulatoryLimits.ts` since
  2026-09-19.
- **Landing page gaps from scroll animations.** There are no scroll animations; the gaps are large
  spacing and no product imagery, which belongs to the landing redesign.
- **"The strategy is the shoebox approach."** Set aside on 2026-10-08 as a guess that contradicted
  the 2026-08-12 bank-sync-first decision; **adopted on 2026-10-09** by the founder (L13, L14).

## 6. Housekeeping

- The audit's test account, `reclaim.audit.test1@mailinator.com`, sits in a public inbox. Delete
  it once it is no longer needed.
