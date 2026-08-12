# Reclaim — Finalized User Workflow Spec (v1)

> [!IMPORTANT]
> **This is the source of truth for Reclaim v1.** Approved 2026-08-12.
>
> It **supersedes [`docs/PRODUCT_BRIEF.md`](../../docs/PRODUCT_BRIEF.md)** wherever the two disagree —
> specifically the capture model, the expense state machine, the navigation model, and the 6-phase
> build plan. The brief is retained as historical reference because ~20 files cite it by section number.
>
> Read this document before any feature work.

## Context

Reclaim (formerly Wellth.ai) currently has three overlapping ways to get an expense into the system (receipt upload wizard, manual entry, Plaid sync), two competing reimbursement subsystems writing to two different status columns, and a bank-sync layer that was built as a supporting feature rather than the spine.

After evaluating competing HSA apps, the decision is to **rebuild the product around bank sync as the primary capture mechanism**. Bank sync is the only source that knows what the user _actually paid out of pocket_ — receipts show billed amount, EOBs show allowed amount, and only the transaction shows post-insurance responsibility, which is the reimbursable number.

The user-facing spine is three steps: **Categorize → Substantiate → Reimburse.**

This document defines the finalized workflow. It is the input to a subsequent in-depth codebase review and implementation plan; it deliberately describes behavior, not schema.

---

## Locked decisions

| Decision                                    | Choice                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Organization model                          | Tags + rich filters + saved views + search. **No folder tree.** Auto-grouping into care events where clustering is confident. |
| Where eligibility is decided                | **Substantiation step**, not categorization. Categorization is Medical / Non-medical only.                                    |
| Review feed scope                           | **Likely-medical only** by default. Pre-decided transactions remain fully accessible with bulk actions and rules.             |
| Partial reimbursement                       | **Editable reimbursable amount + transaction splitting.** No partial-payment ledger.                                          |
| Bidirectional document→transaction matching | **Deferred to v1.1.** Expense-first in v1; manual entry covers the receipt-first case.                                        |
| Legacy surfaces                             | **Aggressive removal.** One canonical path. The old flow does not constrain the new one.                                      |
| Shoebox strategy                            | **First-class terminal success state**, not an incomplete one.                                                                |

---

## Object model (conceptual)

Three distinct objects. Conflating them is the root cause of most current defects.

**Transaction** — an immutable record of money moving, from Plaid or manual entry. One transaction is _not_ one expense.

**Expense** — the substantiation atom. Carries date of service, patient, documents, eligibility, and amounts. Derived from a transaction (possibly several expenses from one transaction), or created directly by manual entry.

**Reimbursement Request** — an immutable snapshot of a set of expenses submitted to the custodian, plus the generated document package.

### Expense facets (source of truth)

Rather than one mega-status enum, an expense carries three orthogonal facets. This is deliberate: the current codebase's central defect is two overlapping enums that both contain `reimbursed`, written by different subsystems that never agree.

- **Documentation** — `none` | `partial` | `complete`
- **Eligibility** — `unknown` | `eligible` | `conditional` (needs letter of medical necessity) | `ineligible` (+ reason)
- **Claim state** — `unclaimed` | `locked_in_request` | `reimbursed` | `reimbursed_externally` | `not_reimbursable` (HSA-card paid)

### Derived display status (one ladder, computed — never stored twice)

1. Needs review _(transaction, pre-expense)_
2. Needs documentation
3. Needs a letter of medical necessity
4. Not eligible — _reason shown_
5. Ready to claim
6. Claim submitted
7. Reimbursed
8. **Substantiated & banked** _(shoebox — user opted not to claim; a success state)_
9. **Substantiated — HSA-paid** _(documented, never reimbursable)_

### Money model

- `amount_paid` — from the transaction, immutable
- `reimbursable_amount` — defaults to `amount_paid`, user-editable downward
- `reimbursed_amount` — accumulated
- `remaining = reimbursable_amount − reimbursed_amount` — what the double-claim lock guards

---

## Step 0 — Connect first, configure second

**This reorders the original step 1 and step 2, and is a proposal open to reversal.**

Rationale: asking for HSA establishment date and family roster before showing any value is the highest drop-off point in the funnel. Connect accounts → run the historical lookback → show _"We found 47 likely-medical transactions totaling $3,240"_ → then collect the details needed to act on them.

1. Connect banks, credit cards, and the HSA account via Plaid. **Persist accounts**, including type and subtype, so the HSA account is identifiable.
2. Historical lookback (12–24 months) runs immediately; classification runs on the backfill.
3. Show the found-money moment.
4. _Then_ collect: HSA establishment date, family roster, reimbursement strategy (reimburse-as-you-go vs. shoebox).

**HSA establishment date:** most users don't know it. Offer "I'm not sure" → derive a candidate from the earliest HSA account activity via Plaid, or let them pick a year, with a warning that this gate is a hard cliff.

**Family roster:** a real roster entity, not free text. Each member needs a **tax-dependent** flag, not just a name — an adult child on the health plan to age 26 is frequently _not_ a tax dependent, and their expenses are therefore not HSA-eligible. This is a common and costly trap.

**HSA custodian coverage risk:** Plaid coverage for HSA custodians is uneven, and some connect as investment accounts with no transaction data. A manual fallback for HSA balance and distributions is required, not optional.

---

## Step 1 — Categorize (Medical / Non-medical)

The only question asked here. Eligibility is not decided at this step.

### The review feed

- Defaults to **likely-medical transactions only**. Non-medical transactions are auto-decided and silent — the user never reviews Netflix.
- Reviewed items leave the feed immediately.
- Merchant-grouped bulk review: _"18 transactions from Walgreens — medical?"_
- The current keyword classifier matches on `"rx"`, `"lab"`, `"dr "`, `"health"` and will flag Dr Pepper and Bath & Body Works. It must be rebuilt around MCC codes and Plaid's stable `merchant_entity_id`, with keywords as a low-confidence fallback only.

### The archive

Auto-decided non-medical transactions are archived, not hidden. From the archive the user can:

- Search and filter
- Bulk-flip a vendor to Medical or Non-medical (retroactively, across all history)
- Create a rule from any transaction

Every auto-decision shows **why** — _"Categorized non-medical: MCC 5411 (Grocery Stores)."_ Audit-anxious users need the reasoning visible, and it makes disagreement actionable rather than mysterious.

### Outcomes of a review decision

- **Non-medical** → archived, reversible.
- **Medical** → creates an Expense (or several — see splitting).
- **Medical, paid with the HSA card** → creates an Expense with claim state `not_reimbursable`. It still requires substantiation (the IRS requires documentation for distributions), but it can never enter a reimbursement request. **This is the single most important guard against double-counting.**
- **Already reimbursed elsewhere** → user records the prior reimbursement inline; expense goes to `reimbursed_externally`. Documentation optional if marked fully reimbursed.

### Splitting

A single transaction becomes N expenses plus a non-medical remainder. This covers both partial-eligibility cases:

- **Mixed basket:** $87 Walmart → $12 Tylenol (medical expense) + $75 remainder (auto non-medical).
- **Bundled payment:** $2,400 hospital payment → three expenses, different service dates, different family members, potentially different tax years.

Constraint: the sum of splits may not exceed the transaction amount.

### Rules

- **Learn from the first decision:** _"You marked CVS as medical. Apply to 47 past and all future CVS transactions?"_ — retroactive apply is the point.
- A **rules management screen**: list, edit, delete, and see what each rule has affected. Today the app silently writes vendor preferences with no UI and **no way to undo a mislabel** — that must not survive.
- Rules key on `merchant_entity_id` + MCC, not on raw description strings, which vary wildly (`SQ *DR SMITH`, `TST* …`).
- Every rule application is reversible and shows its provenance on the affected transaction.

### Transfer detection

Required, not optional — without it the app's own medical-spend totals are visibly wrong on day one, which is fatal to trust in a finance product.

- Detect credit-card payments from checking, and internal account transfers. These are excluded from both categorization and totals, and matched to their counterpart.
- **Explicit user warning** when the situation arises: _reimburse the original merchant charge on the credit card, not the credit-card payment from checking._
- The HSA → checking reimbursement deposit is the same machinery pointed at a different pair — see Step 3.

### Duplicate detection

Warn on suspected duplicates in all three directions:

- Pending vs. posted twins of the same charge
- Manual entry vs. an already-synced transaction
- Sync vs. sync (re-delivery)

The user resolves: merge, or confirm they are genuinely distinct.

---

## Step 2 — Substantiate

Where documentation, service date, patient, and eligibility are resolved together.

### What the user adds

- **Multiple documents per expense**, no restriction on file type. An inline note explains what the IRS would want in an audit (itemized statement or receipt showing provider, date of service, patient, service description, and amount) without blocking anything else.
- **OCR** extracts vendor, amounts, dates, and invoice number for confirmation — suggestions the user accepts, never silent overwrites.
- **Date(s) of service** — multiple dates supported for a single payment. Note that the IRS ties an expense to date of service, not date of payment; this drives both the establishment-date gate and tax-year assignment.
- **Patient** — selected from the family roster.
- **Tags** — free-form, multi-axis.
- **Reimbursable amount** — defaults to `amount_paid`, editable downward for cases like an insurance refund arriving later.

### Eligibility determination — three gates

Only the third is genuine user judgment. The first two are computed and _reported_, not asked.

**Gate 1 — Timing (objective).** Date of service must be on or after the HSA establishment date. A hard cliff: one day early is never eligible, ever. Computed automatically; the user is told, with the reason shown.

**Gate 2 — Whose expense (semi-objective).** Must be the user, their spouse, or a **tax dependent**. Driven by the roster's tax-dependent flag, since plan coverage and tax dependency diverge.

**Gate 3 — Nature of the expense (Pub 502 — judgment lives here).** Three outcomes:

- **Qualified** — most volume. Doctor, dentist, prescriptions, labs, vision, therapy. OTC medications and menstrual products qualify without a prescription (2020 onward).
- **Conditional** — eligible only with a letter of medical necessity or specific circumstances: gym memberships, weight-loss programs, special foods, home modifications, some travel and lodging. Prompts for the additional document rather than silently allowing or denying.
- **Not qualified** — cosmetic procedures (unless correcting a deformity or injury); most insurance premiums, with carve-outs for COBRA, coverage while receiving unemployment, Medicare Parts A/B/D (not Medigap), and long-term-care premiums up to age-based caps.

**Gate 4 — honor system, one checkbox on the request, not a workflow step:** the expense was not deducted on Schedule A and was not reimbursed by an FSA or HRA.

The Pub 502 rules table and the classifier that returns a rule ID plus reasoning already exist in the codebase — they run at the wrong step today, not the wrong way.

### Manual entry (first-class, not an escape hatch)

Bank sync structurally cannot see:

- **Medical mileage** — Pub 502 allows a per-mile amount; real recurring money for anyone managing a chronic condition
- Cash payments
- Certain premiums

Manual entry creates an Expense directly, skipping Step 1, and is the v1 answer to the receipt-first workflow.

---

## Step 3 — Reimburse

### Building a request

Two equivalent entry points: multi-select from the expense list, or a dedicated reimbursement tab where expenses are selected into a request. Only expenses that are `eligible` and `unclaimed` with `remaining > 0` are selectable.

### Deliverable (v1)

- An **exportable ZIP** containing all supporting documentation for the included expenses
- A computed reimbursement total
- A cover summary listing each expense with patient, date of service, provider, category, Pub 502 basis, amount, and the Reclaim confirmation timestamp
- Custodian-specific submission instructions where known

The user submits to their custodian themselves. Direct submission is explicitly post-v1.

### Double-claim prevention

Marking an expense reimbursed is necessary but fires too late — two requests generated days apart, before either deposit lands, can legitimately contain the same expense. The lock must happen **on inclusion in a request, not on arrival of money**.

1. **Lock on inclusion.** An expense's `remaining` amount can be committed to at most one active (non-voided) request. Enforced at the database level, not in application code.
2. **Voiding releases cleanly.** A custodian rejection voids the request in one action, returning every expense to claimable. The voided request stays in history rather than being deleted.
3. **Duplicate expense records** are the sneakier version — two records for one real-world expense each look independently unreimbursed. Covered by the duplicate detection in Step 1, which must also fire on manual entry against synced transactions.
4. **HSA-card expenses can never enter a request** (claim state `not_reimbursable`).
5. **Immutable snapshots.** A submitted request captures expense values at submission time; later edits to the expense do not alter submitted history. _(Already built in the current substantiation-record tables — keep this.)_

### Closing the loop

When the HSA → checking reimbursement deposit lands, transfer matching identifies it against the open request and prompts the user to confirm. On confirmation, `reimbursed_amount` is applied and the request closes. Matching should tolerate batched and rounded custodian payments rather than requiring an exact-cent match.

### Shoebox — a terminal success state

Users pursuing the shoebox strategy deliberately do not reimburse, letting the HSA compound tax-free while holding documentation for decades. For them, a fully substantiated, unclaimed expense is **finished**, and the app must never nag about it.

- Strategy is set during onboarding and changeable at any time.
- Shoebox users see: _"Substantiated & banked — $12,400 ready to claim whenever you want."_
- Submission reminders are suppressed for shoebox users.

---

## Step 4 — Organize (tags, filters, search, saved views)

No folder tree. Retrieval under stress is the actual job: _"everything for Maya in 2025 that isn't reimbursed yet."_ That is a filter, not a folder.

- **Tags** — free-form, multi-axis, one expense in many tags
- **Filters** — service date, payment date, amount, patient, eligibility, documentation completeness, claim state, tax year, account, vendor
- **Saved views** — named filter combinations, functioning as the "folders" mental model without single-hierarchy misfiling
- **Full-text search** — across vendor, notes, tags, and OCR-extracted document text
- **Auto-grouping into care events** where clustering is confident, always as a suggestion the user accepts

---

## Deferred to v1.1

- Bidirectional matching (a loose document finding its own transaction)
- Direct submission to custodians
- Full partial-payment ledger (multiple reimbursements against one expense over time)
- FSA support
- Household / multi-HSA accounts
- Wellbie AI chat (already flagged off)

---

## Open items to resolve during implementation planning

1. **Medical mileage mechanics** — entry UX, per-mile rate sourcing, and where it lives in the regulatory-limits module.
2. **Conditional-eligibility catalog** — which Pub 502 categories are marked conditional, and the prompt copy for each.
3. **Custodian submission instructions** — which custodians ship with specific guidance in v1.
4. **Transfer-matching confidence thresholds** — and what happens to unmatched transfers.
5. **Historical lookback window** — 12 vs. 24 months, and Plaid consent and cost implications at the target price point.

---

## Next step

An in-depth codebase review against this spec, producing an implementation plan. Known structural gaps already identified that the review will need to size:

- Plaid sync uses `/transactions/get` with a date window rather than cursor-based `/transactions/sync` — no handling of removed or modified transactions
- No `plaid_accounts` table; accounts are fetched at link time and discarded, so an HSA account cannot be distinguished from checking
- No family roster; `patient_name` is free text
- No rules table and no rules UI
- No ZIP export; no partial-reimbursement support on the reimbursement axis
- Two competing reimbursement subsystems writing to two different status columns
- Three orphaned pages plus a legacy reimbursement flow slated for removal
