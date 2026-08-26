# Wellth.ai Expense Lifecycle Redesign — Design Document

> **Status**: Design proposal (not yet approved for implementation)
> **Date**: 2026-04-12
> **Scope**: Reimagining the core workflow for bills, transactions, documents, care events, and reimbursement

---

## Phase 1: Current State Audit

### Data Model Summary

The system has **three parallel tracking concepts** that users must mentally reconcile:

| Concept                           | Table                  | What It Represents            |
| --------------------------------- | ---------------------- | ----------------------------- |
| **Invoices** (bills)              | `invoices`             | What the provider charges you |
| **Transactions** (bank activity)  | `transactions`         | What your bank shows          |
| **Payment Transactions** (bridge) | `payment_transactions` | How an invoice was paid       |

Supporting entities:

- **Receipts** (`receipts`) — uploaded documents, dual-linkable to invoices OR payment_transactions, with OCR data in `receipt_ocr_data`
- **Collections** (`collections`) — optional care event grouping via `collection_id` on invoices/receipts. Computed totals via triggers
- **Labels** (`labels`) — flexible tagging across invoices, receipts, payments via junction tables
- **Reimbursement Requests** (`reimbursement_requests`) — batch HSA claims grouping invoices via `reimbursement_items`
- **Bill Reviews / Errors / Disputes** — AI analysis pipeline with error detection and dispute case management
- **Transaction Invoice Suggestions** (`transaction_invoice_suggestions`) — smart matching with confidence scores
- **Transaction Splits** (`transaction_splits`) — splitting one bank transaction across HSA accounts

### Schema Gaps Identified

1. **Invoice status is fragmented** — no single status enum. State scattered across `is_reimbursed`, `payment_transactions` existence, `reconciliation_status` on linked transactions, `collection_id` presence
2. **Orphaned receipts possible** — both `invoice_id` and `payment_transaction_id` can be NULL
3. **Collections vs. Labels distinction is confusing** to users
4. **No duplicate invoice detection**
5. **No change audit trail** on invoices
6. **Transaction splits only handle HSA allocation**, not general multi-method splits

### UI Flow Problems

Users must visit **5-7 distinct screens** to fully process a single medical expense:

- Dashboard (quick actions) → Bills page (upload) → Bill Detail (link transactions) → Transactions (review queue) → Payment Entry (record payment) → HSA Reimbursement (claim) → Reimbursement Requests (track)

**Core UX problems:**

1. No unified view of "what needs my attention"
2. Invoice completion status is invisible at a glance
3. The three-concept data model (transaction vs. invoice vs. payment_transaction) is confusing for users
4. Care Events feel like an optional bolt-on, not a natural organizing principle
5. Reimbursement is disconnected from payment tracking
6. Documents float independently unless manually linked

### Backend Capabilities

- **Plaid sync**: Auto-imports transactions with keyword-based medical detection (125+ vendor patterns), user-learned preferences, `needs_review` flagging
- **Receipt OCR**: Gemini 2.5 Flash extracts vendor/amount/date/category/HSA eligibility
- **Smart matching**: `transactionMatcher.ts` calculates similarity scores (vendor 40%, amount 40%, date 20%), stores in `transaction_invoice_suggestions`
- **Bill analysis** (archived): AI detects 12 types of billing errors with evidence
- **Critical gap**: Matching suggests but **never auto-confirms**. No batch reconciliation.

---

## Phase 2: Three Scenarios

### Scenario A: Care-Event-Centric ("The Case File")

**Core metaphor**: Every interaction with the healthcare system starts as a "care event" — a doctor visit, a surgery, a prescription refill. Everything else (bills, transactions, documents, payments) are artifacts filed within it. Like a physical folder labeled "Mom's Knee Surgery - Jan 2026."

**Information architecture**:

- Primary entity: `CareEvent` (enhanced `collections`)
- Home base: Care Events timeline — chronological list of encounters, each with summary badges (billed, paid, outstanding, HSA claimable). Active/incomplete events surface to top.
- Navigation: Home (attention feed), Care Events (primary list), Money (cross-cutting financial summary)
- Entity hierarchy: CareEvent → Invoices → PaymentTransactions + Receipts; CareEvent → BankTransactions; CareEvent → Labels

**Linking UX**:

- Document upload: OCR extracts data → system auto-creates bill AND attempts to match to existing care event by vendor+date. If no match, prompts "Create new or add to existing?"
- Transaction import: Medical-flagged transactions surface in "Review & File" queue with suggested care event matches. User taps to confirm or creates new care event.
- Smart defaults: System pre-creates care events for detected clusters ("You had 3 bills from City Hospital in January — group as one care event?")

**Status visibility**:
Each care event has computed status:

- **Needs Attention** (orange): Unfiled docs, unlinked transactions, unpaid bills
- **In Progress** (blue): Some bills paid, some outstanding
- **Complete** (green): All bills paid, transactions linked, documents filed
- **HSA Claimable** (purple): Has unreimbursed HSA-eligible OOP payments

Progress ring on each card: `(paid + reimbursed) / total_billed`

**Reimbursement**: Embedded within each care event detail page. "HSA Claimable: $X" with one-click "Claim from HSA" button. Can also batch across events from Money screen.

**Data model changes**:

- Rename `collections` → `care_events`. Add: `status` (computed enum), `primary_provider`, `event_date`, `last_activity_at`
- Add `care_event_id` to `transactions` (direct link, not just through invoices)
- Add `invoice_status` enum to `invoices`: draft, unpaid, partially_paid, fully_paid, reimbursed
- New `care_event_auto_suggestions` table
- New `audit_log` table

---

### Scenario B: Smart Inbox / Triage ("Inbox Zero for Healthcare")

**Core metaphor**: Healthcare generates a continuous stream of artifacts. The user's job is to triage each one: confirm a system suggestion, manually classify/link, or dismiss. Goal is "inbox zero." The app feels like a task manager, not a filing cabinet.

**Information architecture**:

- Primary entity: `InboxItem` — polymorphic wrapper around any artifact needing attention
- Home base: The Inbox — scrollable list of action items, ordered by priority. Each card shows what it is, suggested action, one-click buttons. Zero-state: celebratory "all clear" screen.
- Navigation: Inbox (primary, with badge), Ledger (processed items), Reimbursements
- Item types: "Confirm medical?" / "Link transaction to bill?" / "Create bill from OCR?" / "Bill fully paid — mark complete?" / "HSA-eligible expenses ready to claim" / "Insurance adjustment arrived"

**Linking UX**:

- Fully suggestion-driven. Every item comes with pre-computed suggested action. User mostly taps "Confirm."
- Batch mode: Multi-select → batch-confirm, batch-dismiss, batch-assign to care event
- Keyboard shortcuts (M/N/S) extended to ALL item types
- Low-confidence items show inline mini-form for manual input

**Status visibility**:

- Inbox count IS the status. "0 items" = everything handled.
- Persistent header: "X items to review | $Y unreimbursed | $Z outstanding"
- Urgency tiers: red (overdue), yellow (new), gray (low-priority suggestions)

**Reimbursement**: Surfaces as inbox item when cumulative HSA-eligible OOP crosses threshold ($100 default). "You have $X ready to claim — start reimbursement?"

**Data model changes**:

- New `inbox_items` table: `item_type` enum, `source_entity_type/id`, `suggested_action` (JSONB), `priority`, `status` (pending/acted/dismissed/expired)
- Generation triggers on: transaction sync, document upload, bill status change, reimbursement threshold
- Add `invoice_status` enum to `invoices`
- Add `processing_status` to `receipts`: pending_ocr, ocr_complete, linked, orphaned

---

### Scenario C: Automated Ledger with Exceptions ("Set It and Forget It")

**Core metaphor**: The system is an autonomous bookkeeper. It watches bank accounts, intercepts bills, and reconciles everything automatically. The user sees a clean, balanced ledger where most items are already matched. Attention only needed for genuine ambiguities. Think QuickBooks bank reconciliation, specialized for healthcare.

**Information architecture**:

- Primary entity: `LedgerEntry` — unified view merging invoices + transactions into one timeline
- Home base: The Ledger — two-pane view. Left: chronological entries. Right: detail panel. Top: summary bar. Filter for "Exceptions Only."
- Navigation: Ledger (primary), Exceptions (badge count), HSA (reimbursement). Three items total.

**Auto-matching tiers**:

| Tier          | Criteria                                      | Action                      | Confidence |
| ------------- | --------------------------------------------- | --------------------------- | ---------- |
| 1 — Auto-link | Exact vendor + exact amount + date ≤3 days    | Auto-linked, no user action | >0.9       |
| 2 — Suggest   | Close vendor + amount ±5% + date ≤14 days     | One-click confirm           | 0.7–0.9    |
| 3 — Exception | Multiple matches, amount >5% off, or no match | Manual resolution           | <0.7       |

**Linking UX**:

- Automatic by default. After each Plaid sync, matching pipeline runs and auto-links Tier 1 matches without user intervention. This is the key difference from current system.
- Document intake also automatic: OCR → create invoice → run matching → auto-link if Tier 1
- Exception resolution: Split-screen showing unmatched item + ranked candidates
- Learning: Every user correction feeds back (vendor alias learning, threshold adjustments)

**Status visibility**:

- Each ledger row has visual indicator: green check (matched), blue link (auto-matched), yellow warning (suggested), red exclamation (exception), purple HSA (claimable)
- "Health score" percentage: "94% reconciled"
- Unmatched items show "days unresolved" counter

**Reimbursement**: Automatic when possible. If user has configured auto-reimbursement preferences, system generates and queues claim PDFs. User receives notification to review and submit.

**Data model changes**:

- New `ledger_entries` view (Postgres view joining invoices + transactions + payment_transactions)
- New `auto_match_rules` table: vendor_pattern, alias, default_category, auto_link_threshold
- New `vendor_aliases` table: canonical_vendor, alias, source (manual/learned)
- New `matching_run_log` table: observability for auto-matching runs
- Enhance `transaction_invoice_suggestions` with: `auto_linked`, `auto_linked_at`, `user_confirmed`
- Add `invoice_status` enum to `invoices`

---

## Phase 3: Adversarial Analysis

### Scenario A: Care-Event-Centric

| Dimension               | Assessment                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fails for**           | Chronic condition users (50+ tx/month). Creating care events for every pharmacy fill or monthly lab draw is exhausting. Also fails for "I just want my HSA money back" users who think in terms of money, not medical encounters.                                                                                                  |
| **Breaking edge cases** | One bill covering multiple visits (which event?). One visit generating bills from 4 vendors (surgeon, anesthesiologist, facility, lab — system may not auto-cluster). Insurance adjustments months later reopening "complete" events. Payment plans keeping events "in progress" for months. Pharmacy fills not tied to any visit. |
| **Implementation risk** | Medium-high. Requires renaming/enhancing collections, computed status triggers, auto-clustering logic, navigation redesign. Care event auto-suggestion engine is riskiest new component.                                                                                                                                           |
| **Cognitive load**      | High initially — users must learn to think in "care events." Good once trained for episodic users. Bad for continuous/chronic healthcare.                                                                                                                                                                                          |
| **Metaphor breaks**     | Preventive care and routine maintenance feel awkward as "events." Financial-first users find it backwards. Assumes healthcare is episodic; for chronic conditions, it's continuous.                                                                                                                                                |

### Scenario B: Smart Inbox / Triage

| Dimension               | Assessment                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fails for**           | Annual reviewers — log in at tax time, see 200+ items. Overwhelming. Also anxiety-prone users — a constantly non-zero count creates stress and avoidance.                                                                                                                |
| **Breaking edge cases** | Duplicate items (transaction syncs AND bill uploaded for same expense). Cascading updates (confirm one item → triggers 3 new items). Stale items from months-old insurance adjustments with no context. Informational items with no clear action ("deductible 60% met"). |
| **Implementation risk** | High. Entirely new `inbox_items` infrastructure. Priority scoring must be carefully tuned. Polymorphic item types add UI complexity. Generation triggers prone to double-firing and race conditions.                                                                     |
| **Cognitive load**      | Low per-item, but scales linearly with volume. Power users feel like they're on a treadmill. No natural way to "zoom out" and see the big picture.                                                                                                                       |
| **Metaphor breaks**     | Healthcare expenses have long tails (payment plans, negotiations, reimbursement cycles). "Processed" items may need revisiting months later. Mixing urgent items with informational ones dilutes attention.                                                              |

### Scenario C: Automated Ledger with Exceptions

| Dimension               | Assessment                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fails for**           | Control-oriented users who want to review everything manually — auto-linking feels presumptuous. Also no-bank-connection users — without Plaid, the auto-matching engine has nothing to work with and the ledger is just a bills list.                                                                                                  |
| **Breaking edge cases** | False positive auto-links (two visits to same provider, same week, similar copay amounts). Split payments ($500 HSA + $200 credit card for same bill). Refunds/credits (negative amounts don't match bills). Multiple HSA accounts needing separate tracking. Delayed posting (bill arrives 5th, payment posts 12th with date of 10th). |
| **Implementation risk** | Highest. Auto-matching pipeline must be reliable, fast, correct. False positives erode trust quickly. `ledger_entries` materialized view adds DB complexity. Learning/feedback loop is ML-adjacent.                                                                                                                                     |
| **Cognitive load**      | Lowest day-to-day. BUT: user must trust the system. Trust requires transparency (showing WHY auto-matched) and easy undo. If trust erodes, user is worse off than manual system.                                                                                                                                                        |
| **Metaphor breaks**     | Ledger works for "did money move correctly" but poorly for "what happened to me medically." Many healthcare items are one-sided (bill with no payment, transaction with no bill). "Exceptions" framing implies rarity — but early on, most items WILL be exceptions.                                                                    |

---

## Phase 4: Synthesis & Recommendation

### The Winning Approach: Hybrid (C + B + A)

**Automated Ledger (C) as foundation** + **Smart Inbox (B) as interaction layer** + **Care Events (A) as optional organizational overlay**.

**Why this hybrid wins:**

1. **Scenario C provides the highest long-term value** — healthcare expense management is fundamentally a reconciliation problem. The current system already has the matching algorithm, suggestion table, and Plaid sync — it just stops short of auto-linking. Flipping that switch is the single highest-leverage change.

2. **Scenario B provides the best interaction model for exceptions** — rather than forcing users to navigate 5-7 screens to find problems, a unified attention queue surfaces everything in one place.

3. **Scenario A provides organizational structure for power users** — care events are valuable for complex episodes but add friction for routine expenses. Making them optional and auto-suggested gives the benefit without the overhead.

**In concrete terms:**

| Layer             | Source          | What It Does                                                                                                                  |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Default view**  | Ledger (C)      | Clean, auto-reconciled view of all medical expenses. Each row: bill + matched transaction + payment status + HSA eligibility. |
| **Interaction**   | Inbox (B)       | Inline attention bar at top of ledger. "3 items need review" — expands to show action cards. Not a separate page.             |
| **Organization**  | Care Events (A) | Auto-suggested when system detects clusters. User can accept/merge/ignore. Never required.                                    |
| **Reimbursement** | Embedded        | Persistent "HSA Claimable: $X" banner on ledger with one-click claim initiation.                                              |

### Best Elements Stolen from Each Scenario

**From A (Care Events):**

- `invoice_status` computed enum (all three scenarios need this)
- Care event auto-clustering logic (auto-suggest groupings)
- Timeline view for complex medical episodes

**From B (Smart Inbox):**

- Priority scoring for attention items (overdue > match suggestion > new transaction)
- Keyboard shortcuts extended to ALL item types
- "Inbox zero" celebration animation

### Highest-Leverage Quick Wins (Ship Independently)

#### Quick Win 1: `invoice_status` Computed Column

Add enum to `invoices`: `draft`, `unpaid`, `partially_paid`, `fully_paid`, `reimbursed`. Computed via trigger on `payment_transactions` changes. Enables status badges, filtering by status, dashboard completeness metric. Replaces confusing `is_reimbursed` boolean.

**Effort**: 1 migration + 1 trigger + UI badge updates. ~1 day.

#### Quick Win 2: Auto-Link High-Confidence Matches

When confidence > 0.9 (exact vendor + exact amount + date ≤3 days), auto-create `payment_transaction` and set `reconciliation_status = 'linked_to_invoice'`. Add "auto-matched" badge and one-click undo.

**Effort**: Modify Plaid sync edge function + add `auto_linked` column + undo UI. ~2 days.

#### Quick Win 3: Unified Attention Count on Dashboard

Single "X items need attention" counter aggregating: unreviewed transactions + unlinked medical transactions + unpaid bills >30 days + HSA-claimable amount. One "Review Now" button opening focused queue. Frontend-only, no schema changes.

**Effort**: New `useAttentionItems` hook + `AttentionBanner` component. ~1 day.

### Phased Implementation Roadmap

| Phase                       | Weeks | Scope                                                                                                                                                                                        |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0: Quick Wins**           | 1–2   | `invoice_status` enum + trigger. Unified attention count on Dashboard. Status badges on Bills list.                                                                                          |
| **1: Auto-Matching**        | 3–5   | Auto-link high-confidence matches. `vendor_aliases` table + learning loop. "Undo auto-match" UI. `matching_run_log` for observability.                                                       |
| **2: Unified Ledger**       | 6–9   | `ledger_entries` database view. New Ledger page replacing Bills + Transactions lists. Filters: date, vendor, status, HSA, care event. Keep old pages accessible but remove from primary nav. |
| **3: Attention Queue**      | 10–12 | `inbox_items` table + generation triggers. Inline attention bar on Ledger page. Priority scoring. Extended keyboard shortcuts. Batch operations.                                             |
| **4: Optional Care Events** | 13–15 | Enhance `collections` with computed status. Auto-clustering (detect invoice groups by vendor+date). Inline care event creation from ledger (select items → "Group as care event").           |
| **5: Smart Reimbursement**  | 16–18 | Embed reimbursement in ledger. Per-care-event claims. Auto-generate claim when OOP exceeds threshold. File PDFs back into care events.                                                       |

### Critical Files for Implementation

| File                                                  | Role in Redesign                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/transactionMatcher.ts`                       | Upgrade to auto-linking engine (Phase 1)                            |
| `src/components/bills/LinkTransactionDialog.tsx`      | Refactor into ledger row actions (Phase 2)                          |
| `src/components/transactions/ReviewQueue.tsx`         | Merge into attention queue (Phase 3)                                |
| `supabase/functions/plaid-sync-transactions/index.ts` | Add auto-link logic post-sync (Phase 1)                             |
| `src/pages/Dashboard.tsx`                             | Add attention banner (Phase 0)                                      |
| `src/pages/Bills.tsx`                                 | Add status badges (Phase 0), eventually merge into Ledger (Phase 2) |
| `src/integrations/supabase/types.ts`                  | Updated after each migration                                        |
| `supabase/migrations/`                                | New migrations for each phase                                       |
