# Reclaim — Bank-Sync Rebuild: Codebase Review & Implementation Plan

> Companion to [`bank-sync-workflow-spec.md`](./bank-sync-workflow-spec.md), which is the product source of truth.
> This document is the engineering assessment and build order. Written 2026-08-12.

---

## Executive summary

The bank-sync layer is **thinner and more broken than its file count suggests.** Four Plaid edge functions, a shared classifier, a webhook with real JWT signature verification, and an auto-matching pipeline all exist and are genuinely well-commented — but the ingestion core has three defects that make it unusable as a product spine:

1. **No pagination.** `/transactions/get` is called with no `count`/`offset`, so Plaid's default of 100 applies. The "18-month historical wow moment" returns **at most 100 transactions**, silently.
2. **No account linkage.** `account_id` is never persisted on a transaction. The HSA account cannot be distinguished from checking, which blocks HSA-card handling, transfer detection, and reimbursement-deposit matching — three of the spec's load-bearing features.
3. **No cursor.** Date-window fetches mean removed and modified transactions are never reconciled.

The good news: the **Pub 502 rules table, the AI expense classifier, the substantiation-record snapshot design, the receipts model, and the HSA date-eligibility logic are all sound and reusable.** This is a rebuild of the ingestion and state layers, not of the compliance layer.

---

## Part 1 — Review findings

### 1.1 Sync layer (`supabase/functions/plaid-*`)

| #   | Finding                                                                                                                                                                                                                                                                                                            | Location                                                                     | Severity     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------ |
| S1  | **No pagination on `/transactions/get`.** `count`, `offset`, `total_transactions` appear nowhere in the codebase. Plaid defaults `count` to 100. The 540-day initial sync therefore caps at 100 transactions.                                                                                                      | `plaid-sync-transactions/index.ts:126-141`, `plaid-webhook/index.ts:171-181` | **Critical** |
| S2  | **`account_id` never persisted.** Plaid returns it on every transaction; it is dropped. No `plaid_accounts` table exists — `/accounts/get` output is returned to the client at link time and discarded.                                                                                                            | `plaid-exchange-token/index.ts:110-152`                                      | **Critical** |
| S3  | **No cursor-based sync.** Both paths use date windows. `removed_transaction_ids` is never processed; voided charges persist forever. Manual sync uses `ignoreDuplicates: true`, so pending→posted amount changes never update.                                                                                     | both                                                                         | **Critical** |
| S4  | **Sign is destroyed on write.** `amount: Math.abs(txn.amount)` — after storage, a debit and a credit are indistinguishable. The deposit matcher works around this by reading the raw Plaid payload before insert, which is why it only functions inside the sync request.                                          | `plaid-sync-transactions:217`, `plaid-webhook:223`                           | **High**     |
| S5  | **`pub502RuleId` dropped in the manual-sync path.** The `classifications` array type and its `push` omit the field, but the auto-capture block reads `c?.pub502RuleId`. Always `undefined`. Identical transactions land in different lifecycle states depending on whether the webhook or the sync saw them first. | `plaid-sync-transactions:182-209` vs `:431-437`                              | **High**     |
| S6  | **Webhook ignores `webhook_code`.** `HISTORICAL_UPDATE` gets the same hardcoded 30-day window as `DEFAULT_UPDATE`, so webhook-driven backfill never exceeds 30 days. `SYNC_UPDATES_AVAILABLE` is handled identically.                                                                                              | `plaid-webhook:169-181`                                                      | **High**     |
| S7  | **`institution_name` actually stores `institution_id`.** Users see a raw Plaid ID. Display name requires `/institutions/get_by_id`.                                                                                                                                                                                | `plaid-exchange-token:127`                                                   | Medium       |
| S8  | **Sequential per-transaction DB round-trips** in auto-capture and the webhook loop. At true backfill volume this risks edge-function timeout.                                                                                                                                                                      | both                                                                         | Medium       |
| S9  | Dead conditional: `if (classification.isMedical && !txnRow.invoice_id && true)`.                                                                                                                                                                                                                                   | `plaid-webhook:265-272`                                                      | Low          |

**Needs verification before building:** the classifier's tier-2 MCC lookup depends on `txn.mcc`. I could not confirm that Plaid's Transactions product returns a raw `mcc` field on the standard transaction object — the in-code comment asserts it does, but if it is usually absent, tier 2 never fires and everything falls through to keyword matching. **Check a real sandbox payload first**, because this single fact determines whether the classifier rewrite is a tuning job or a redesign around `personal_finance_category` and `merchant_entity_id`.

### 1.2 Classification & rules

- `_shared/medicalClassifier.ts` keyword list contains `"lab"`, `"rx"`, `"health"`, `"vision"`, `"sharp"`, `"dr "` — matched as **unanchored substrings**. These will flag Dr Pepper, Univision, Sharpie, and anything containing "collab". Straight into the review queue.
- The list is duplicated client-side in `src/lib/medicalVendors.ts`, maintained separately, already drifting.
- **No rules table and no rules UI.** `user_vendor_preferences` is written silently from three call sites (`src/pages/Transactions.tsx:376,414`, `src/hooks/useInboxItems.ts:220`) and read only by the classifier. There is **no way to list, edit, or undo** a preference — a mislabelled vendor is permanent from the UI.
- Rules key on lowercase substring of vendor name, not on `merchant_entity_id`.
- Tier 2 (MCC) returns `needsReview: false` and callers set `is_hsa_eligible: c.isMedical && !c.needsReview` — **eligibility is being decided at ingestion**, which the spec explicitly moves to substantiation.

### 1.3 Object model & status

`invoices` **is** the expense table (lineage: `expenses` → `expense_reports` → `invoices`). There is no separate transaction/expense distinction — auto-capture creates one invoice per medical transaction, 1:1, with no split or merge path.

Four overlapping status representations on `invoices`:

| Axis        | Column                                               | Driven by                                |
| ----------- | ---------------------------------------------------- | ---------------------------------------- |
| Payment     | `status` (`invoice_status` enum)                     | DB trigger off `payment_transactions`    |
| Eligibility | `lifecycle_status` (`invoice_lifecycle_status` enum) | App code only                            |
| Legacy      | `is_reimbursed` boolean                              | `HSAReimbursement.tsx`, `BulkImport.tsx` |
| Legacy      | `is_hsa_eligible` boolean                            | category matching at upload              |

**Both enums contain `reimbursed`, and the two reimbursement subsystems write to different ones.** Reimburse via `/hsa-reimbursement` (sets `is_reimbursed`) and the expense still reads as `eligible` on the Dashboard and in `/substantiation`. This is a live user-visible contradiction.

`transaction_splits` exists but splits only HSA-account allocation, not expense identity — it cannot express the Walmart mixed-basket case.

### 1.4 Documents

Healthy. Keep nearly all of it.

- Single private storage bucket `receipts`, RLS keyed on first path segment = user UUID.
- `receipts` is genuinely **1:many** per invoice with `display_order` — multi-document is already supported.
- `document_type` CHECK covers receipt / invoice / bill / itemized_statement / eob / payment_receipt / payment_plan_agreement / other.
- OCR lands in `receipt_ocr_data` with `extracted_service_date` already present — exactly what the substantiation step needs.
- Four different storage-path conventions coexist across upload call sites; worth normalizing.

### 1.5 Reimbursement & export

- **Two parallel systems ship simultaneously**: legacy `reimbursement_requests` + `reimbursement_items`, and current `substantiation_records` + `substantiation_record_items`.
- **Double-claim gap confirmed.** `substantiation_record_items` has `UNIQUE (substantiation_record_id, invoice_id)` — which prevents the same expense twice _within one record_, but **nothing prevents it appearing in two different records**. Verified against `20260605130000_phase4_substantiation_records.sql:87`.
- **No partial reimbursement anywhere.** `reimbursement_items` has only three columns and no amount. `amount_at_submission` snapshots the full invoice amount.
- **No ZIP capability.** No `jszip`/`fflate`/`archiver` in `package.json` — only `jspdf ^4.2.1`.
- `ReimbursementDetails.tsx:62` joins `expense:expenses(*)` — **`expenses` is not a table**. The attached-expenses card and its exports are silently broken.
- Snapshot immutability design is good and should survive the rebuild.

### 1.6 Surfaces

42 routes, 43 page components, ~66k LOC in `src/`.

**Confirmed orphans** (on disk, not routed, not imported anywhere) — ~73KB:
`ExpenseList.tsx`, `BulkImport.tsx`, `InvoicePaymentList.tsx`, `InvoicePaymentListEnhanced.tsx`

`InvoicePaymentList.tsx:159-173` performs an **unprompted destructive `UPDATE invoices SET is_hsa_eligible = false`** in a mount effect. Dead today; must not be revived.

### 1.7 Reusable assets — do not rebuild these

| Asset                          | Path                                                           | Use for                                                                                |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| HSA date-eligibility logic     | `src/hooks/useHSAEligibility.ts`, `src/lib/hsaAccountUtils.ts` | **Gate 1** (timing) verbatim — already handles multi-account periods + legacy fallback |
| Pub 502 rules catalog          | `pub_502_rules` table, `mcc_codes.default_pub_502_rule_id`     | **Gate 3** (nature)                                                                    |
| AI expense classifier          | `_shared/expenseClassifier.ts`, `classify-expense/index.ts`    | Gate 3 — move its invocation from capture to substantiation                            |
| Plaid webhook JWT verification | `_shared/plaidWebhookVerification.ts`                          | Keep as-is                                                                             |
| Token encryption               | `_shared/encryption.ts`                                        | Keep as-is                                                                             |
| Snapshot-on-submit design      | `substantiation_record_items`                                  | Keep; extend with amounts                                                              |
| Receipts + OCR model           | `receipts`, `receipt_ocr_data`                                 | Keep nearly whole                                                                      |
| Deposit matcher                | `_shared/depositMatcher.ts`                                    | Rework to use account linkage instead of raw-payload sign                              |

---

## Part 2 — Implementation plan

Ordered by dependency. Workstreams A and B unblock everything else.

### Workstream A — Ingestion rebuild _(blocks everything)_

**A1. `plaid_accounts` table.** New migration. Columns: `id`, `user_id`, `connection_id`, `plaid_account_id` (unique), `name`, `official_name`, `mask`, `type`, `subtype`, `is_hsa` (derived from subtype `hsa`, user-overridable), `is_active`. Populate in `plaid-exchange-token` where accounts are currently discarded (`index.ts:110-152`), and refresh on each sync.

**A2. Add `account_id` + signed amount to `transactions`.** Migration adds `plaid_account_id` FK and `signed_amount NUMERIC`. Backfill `signed_amount` from existing `amount` where derivable; leave null otherwise. Retain `amount` as absolute for existing consumers during transition.

**A3. Rewrite sync on `/transactions/sync`.** New `_shared/plaidSync.ts` used by both the webhook and the manual path. Adds: cursor persistence on `plaid_connections`, `has_more` loop, `added`/`modified`/`removed` handling, and idempotent upsert. This replaces the pagination gap (S1), the cursor gap (S3), and the webhook's window bug (S6) in one change.

**A4. Fix the classification carry-through.** Add `pub502RuleId` to the `classifications` array type and push (S5). Better: have `_shared/plaidSync.ts` return classification alongside each row so the array-lookup pattern disappears entirely.

**A5. Institution display name.** Call `/institutions/get_by_id` at link time; store both id and name (S7).

**A6. Batch the writes.** Replace per-transaction inserts with chunked bulk upserts (S8).

### Workstream B — Transaction / Expense split _(blocks C, D, E)_

**B1. Separate the objects.** `transactions` becomes the immutable bank record. Introduce the expense as a distinct entity with a FK back to its source transaction, **many expenses per transaction**. Rename or alias `invoices` → expenses at the same time; the brief already flagged this naming debt (§21).

**B2. Three orthogonal facets + one derived display status.** Replace `lifecycle_status`, `status`, `is_reimbursed`, and `is_hsa_eligible` with `documentation_state`, `eligibility_state`, `claim_state`, and a derived view for display. **Do not add a fifth column alongside four existing ones** — the migration must drop the legacy pair, not coexist with it.

**B3. Splitting.** Split UI + backend so one transaction yields N expenses plus an auto-non-medical remainder, with a `sum(splits) <= transaction.amount` constraint. Covers both the Walmart mixed basket and the bundled hospital payment. `transaction_splits` is the wrong shape for this (HSA-allocation only) and should be superseded.

**B4. Money model.** `amount_paid` (immutable), `reimbursable_amount` (defaults to `amount_paid`, editable down), `reimbursed_amount`, with `remaining` derived.

**B5. HSA-card expenses.** Transactions whose `plaid_account_id` resolves to `is_hsa = true` create expenses at `claim_state = 'not_reimbursable'`. Enforce with a DB constraint, not app logic.

### Workstream C — Categorization, rules, transfers

**C1. Rebuild the classifier.** Anchor keyword matching on word boundaries, drop the substring traps (`lab`, `rx`, `health`, `sharp`, `dr `), and prefer `personal_finance_category` + `merchant_entity_id`. **Verify MCC availability first** — see §1.1. Delete the duplicate client-side list in `src/lib/medicalVendors.ts` and import the shared module.

**C2. Stop setting eligibility at ingestion.** Remove `is_hsa_eligible` writes from both Plaid paths.

**C3. Rules engine.** New `categorization_rules` table keyed on `merchant_entity_id` (with a name-pattern fallback), plus `applied_by_rule_id` provenance on transactions. Retroactive apply on rule creation. A rules management screen — list, edit, delete, see affected transactions, undo. Migrate existing `user_vendor_preferences` rows into it.

**C4. Review feed.** Rebuild around likely-medical-only, merchant-grouped bulk actions, and a "why" chip surfacing the classification reason. Reuse `useInboxItems.ts` shape but re-source it. Note: fix the dead `confirm_match` trigger — `20260414_create_inbox_items.sql:96` compares a 0–100 score against 0.7/0.9 thresholds, so it can never fire.

**C5. Transfer detection.** Match debit/credit pairs across accounts by amount + date proximity, using the new `plaid_account_id` and `signed_amount`. Exclude matched transfers from categorization and totals. Surface the credit-card warning from the spec. Same machinery serves the reimbursement-deposit match in E4.

**C6. Duplicate detection.** Pending vs. posted, manual vs. synced, sync vs. sync. Warn with merge/keep-both resolution.

### Workstream D — Substantiation & eligibility

**D1. Family roster.** New `family_members` table with `name`, `relationship`, and a **`tax_dependent` flag** (the adult-child-on-insurance trap). Migrate distinct `invoices.patient_name` values into it. Replace free-text inputs in `BillUploadWizard.tsx` and `ExpenseEntry.tsx` with a roster picker.

**D2. Gate 1 — timing.** Reuse `useHSAEligibility` unchanged, keyed on **date of service** rather than bill date. Report the result; never ask the user. (Note: it uses `SELECT *`, which violates CLAUDE.md — enumerate columns while you're in there.)

**D3. Gate 2 — dependency.** Derived from the roster flag.

**D4. Gate 3 — nature.** Move the `classify-expense` invocation from capture to the substantiation step. Extend `pub_502_rules` with a `conditional` eligibility status and LMN prompt copy. Surface `classification_reasoning` in the UI.

**D5. Substantiation screen.** Date(s) of service, roster patient picker, multi-document upload, tags, reimbursable amount. Reuse `ReceiptGallery` and the existing OCR path.

**D6. Manual entry as a first-class peer**, including **medical mileage** with a per-mile rate sourced from `src/lib/regulatoryLimits.ts` (per CLAUDE.md, never hardcode IRS values elsewhere).

### Workstream E — Reimbursement

**E1. Delete the legacy path.** Remove `HSAReimbursement.tsx`, `ReimbursementRequests.tsx`, `ReimbursementDetails.tsx`, the `reimbursement_requests` / `reimbursement_items` tables, and their routes. Migrate any existing rows into `substantiation_records` first.

**E2. Claim lock on inclusion.** An expense may be committed to at most one non-voided record. **Implementation note:** a partial unique index cannot reference another table, so denormalize `record_status` onto `substantiation_record_items` and maintain it with a trigger on `substantiation_records`, then add `CREATE UNIQUE INDEX ... ON substantiation_record_items (invoice_id) WHERE record_status <> 'voided'`. Declarative and race-safe; a BEFORE INSERT check alone is not.

**E3. ZIP export.** Add `fflate` (smaller and faster than `jszip`; no Node polyfill needed in the browser). Bundle receipt files from the `receipts` bucket plus a cover summary PDF via the existing `jspdf` path in `src/lib/substantiationRecord.ts`. Decide client-side vs. edge-function generation based on expected packet size.

**E4. Close the loop.** Reuse C5's transfer matching to detect the HSA→checking deposit against open records. Replace `depositMatcher.ts`'s exact-cent match with a tolerance band to survive batched and rounded custodian payments.

**E5. Voiding.** One action returns every member expense to claimable and preserves the record in history.

**E6. Shoebox terminal state.** Wire `profiles.reimbursement_strategy_preference` (already exists, default `'regular'`) to suppress reminders and relabel the bucket as a success state.

### Workstream F — Deletion & cleanup

**F1. Delete confirmed orphans** (~73KB): `ExpenseList.tsx`, `BulkImport.tsx`, `InvoicePaymentList.tsx`, `InvoicePaymentListEnhanced.tsx`.

**F2. Collapse the status axes** — the B2 migration must drop `is_reimbursed` and `is_hsa_eligible`, not leave them.

**F3. Normalize storage paths** to one convention across all upload call sites.

**F4. Regenerate `src/integrations/supabase/types.ts`** — currently stale, missing `inbox_items`, `ledger_entries`, and the email-forward columns, which suggests those migrations may be **unapplied in production**. Verify before building on them.

**F5. Reconcile IA** with the new workflow: `/ledger`, `/bills`, `/collections`, `/expense-groups`, `/review`, `/substantiation`, and `/transactions` overlap heavily. Decide the final tab set against the spec.

---

## Suggested build order

1. **A** (ingestion) — nothing else is trustworthy until sync is correct
2. **B** (object model) — the migration that unblocks splitting and claim state
3. **C** (categorize) + **D** (substantiate) in parallel once B lands
4. **E** (reimburse)
5. **F** (cleanup) continuously, with F1 doable immediately

---

## Verification

- **Sync correctness:** Plaid sandbox item with >100 transactions over 18 months. Assert stored count equals Plaid's `total_transactions`, that a `/sandbox/item/fire_webhook` removal is reflected, and that a pending→posted amount change updates rather than duplicates.
- **Account linkage:** confirm every transaction row carries a `plaid_account_id` and that HSA-subtype accounts produce `not_reimbursable` expenses.
- **Transfers:** create a card charge + card payment pair in sandbox; assert the payment is excluded from medical totals.
- **Double-claim lock:** attempt to add one expense to two non-voided records; assert the DB rejects it. Void the first; assert the second succeeds.
- **Eligibility gates:** expense dated one day before HSA establishment must be `ineligible` with the reason surfaced; a non-tax-dependent family member must fail Gate 2.
- **Export:** generated ZIP opens cleanly and contains every receipt for the included expenses plus the cover summary.
- **Standard gate:** `npm run build` with zero errors, plus the `verify-app` skill.
- **Migrations:** `npx supabase db reset` on a clean container — per the CLAUDE.md 2026-05-03 lesson, every migration must run from an empty schema.
