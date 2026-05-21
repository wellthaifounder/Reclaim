# Reclaim — Product Brief & V1 Build Plan

> This document is the canonical product brief for Reclaim (formerly Wellth.ai).  
> It was produced through a structured design interview on 2026-05-21 and represents  
> shared understanding between the founder and the development process.  
> All feature and design decisions should be evaluated against this brief before implementation.

---

## 1. Brand

|                   |                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**          | Reclaim                                                                                                                                                                 |
| **Domain**        | `reclaim.health`                                                                                                                                                        |
| **Tagline**       | "Reclaim your HSA money."                                                                                                                                               |
| **Support email** | `support@reclaim.health`                                                                                                                                                |
| **Positioning**   | Custodian-agnostic HSA expense tracking that finds your unclaimed reimbursements and generates the IRS-ready Substantiation Record that protects you in an audit.       |
| **Kill shot**     | "Reclaim works with any HSA. Scan a receipt, we tell you if it's IRS-eligible, and we generate the Substantiation Record that protects you in an audit. In 60 seconds." |

---

## 2. Target User

**Primary:** Health-conscious, financially literate 30–50 year old professional enrolled in an HDHP with an HSA. They are leaving money on the table by not tracking eligible expenses carefully. Anxious about IRS audits. Has disposable income ($12.99–$14.99/mo) but not enough time to manage healthcare finances manually.

**Explicitly deprioritized for v1:** HR administrators managing benefits for entire companies.

---

## 3. Primary Job-To-Be-Done

**#1 — "Help me not lose money."**

The user wants to:

1. Track medical expenses and relevant receipts
2. Easily reimburse eligible amounts from their HSA
3. Maintain a document trail for IRS audits

**#3 (HSA as investment vehicle / shoebox method) is a tangential benefit once #1 is nailed.**

---

## 4. Core Product Decisions

### Reimbursement Flow

**Option 1 — Reclaim prepares, user executes.** The app aggregates eligible expenses, generates the Substantiation Record, and the user logs into their HSA custodian to initiate the transfer. When the corresponding deposit hits their bank account (detected via Plaid), Reclaim automatically prompts to close the loop.

### Primary Expense Capture

**Plaid sync as default trigger, receipt scan as confirmation step.**  
Plaid detects a transaction at a likely-medical merchant → pushes a notification → user scans receipt → expense logged and substantiated in one tap.

### Eligibility Determination

**Option 5 — AI classification + IRS Pub 502 database + user confirmation.**  
AI proposes, Pub 502 database validates, user explicitly confirms. The user's confirmation creates the audit trail. Reclaim never silently auto-approves. Eligibility rules live server-side (Supabase table), updatable without an app release.

### Account Focus

**HSA-first.** FSA data model is supported but FSA-specific UX (deadline countdowns, spending suggestions) is v1.1. Year-end FSA spending alerts are v1.1.

### Historical Lookback

**Option 2 — 12–24 months of Plaid history pulled immediately on account connection.** This is the onboarding activation event. The wow moment: _"We found 14 transactions from the last 18 months that may be HSA-eligible."_

### HSA Balance

**Informational only.** The app is expense-driven, not custodian-account-driven. Direct HSA custodian sync is v1.1.

### Shoebox Method

**First-class strategy.** Users select "Reimburse regularly" or "Shoebox method" during onboarding. Shoebox users see their ELIGIBLE bucket labeled "Shoebox Balance" (not a call-to-action) and the monthly submission reminder is suppressed.

### Patient/Dependent Tagging

**`patient_name` field on all expenses** (Self / Spouse / Dependent). Required for IRS-compliant Substantiation Record. The patient name field is legally required per IRS documentation standards.

### Platform

**PWA mobile-first.** 390px viewport as primary canvas. Camera-first receipt scanning (not upload flow). Desktop is wide-screen layout of the same PWA, optimized for review and export. Verify PWA push notifications on iOS 16.4+.

### Wellbie AI Chat

**Deprioritized for v1.** Do not build until the state machine and eligibility engine are complete. Revisit in v1.1 as a document explainer (EOB translation + HSA-eligible amount extraction).

### Pre-Purchase Decision Tool (Shoebox Calculator)

**Free, ungated tool on the landing page.** No account required. CTA after result: _"Want to track all your shoebox expenses in one place? Join the waitlist."_ Not a paid feature — it's an acquisition tool.

---

## 5. The Core Loop

```
Plaid detects medical transaction
        ↓
Push notification: "Was this $X at [Merchant] a medical expense?"
        ↓
User taps → opens receipt scan flow
        ↓
AI OCR extracts amount, vendor, date, category
        ↓
AI classifies against IRS Pub 502 database → confidence score
        ↓
User confirms eligibility (explicit tap = audit trail)
        ↓
Expense marked ELIGIBLE, receipt attached
        ↓
User generates Substantiation Record (IRS-style PDF)
        ↓
Expense marked SUBMITTED
        ↓
Plaid detects HSA deposit → "Does this $X close your pending reimbursements?"
        ↓
User confirms → REIMBURSED. Loop closed.
```

---

## 6. Expense State Machine

```
CAPTURED → PENDING REVIEW → ELIGIBLE    → SUBMITTED → REIMBURSED
                          ↘ INELIGIBLE
                          ↘ NEEDS RECEIPT
```

| State              | Meaning                                                                      | User action required                |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------- |
| **CAPTURED**       | Imported from Plaid or receipt scanned. Raw, unreviewed.                     | None                                |
| **PENDING REVIEW** | AI has classified it. Awaiting user eligibility confirmation.                | Confirm eligible or mark ineligible |
| **NEEDS RECEIPT**  | Likely eligible but no receipt attached.                                     | Attach receipt                      |
| **ELIGIBLE**       | User confirmed eligible. Receipt attached. Ready for Substantiation Record.  | None — or generate record           |
| **INELIGIBLE**     | User confirmed not eligible. Dismissed.                                      | None                                |
| **SUBMITTED**      | Included in a generated Substantiation Record. Waiting for HSA distribution. | None — reassurance state            |
| **REIMBURSED**     | Loop closed. Plaid detected deposit, user confirmed.                         | None — celebrate                    |

---

## 7. Primary Deliverable — The Substantiation Record

**This is the product's most valuable and defensible output.** Do not call it a "reimbursement PDF." Call it the **Substantiation Record**.

**IRS-style format (primary)** includes per expense:

- Patient name
- Date of service
- Provider / merchant
- Expense category
- IRS Pub 502 eligibility basis (the specific rule that makes it eligible)
- Amount
- Receipt image
- **Reclaim confirmation timestamp** (when the user explicitly confirmed eligibility in-app)

The Reclaim confirmation timestamp is the moat. No competitor produces this.

**Also build:** per-expense receipt packet PDF, simple summary PDF, CSV export.

---

## 8. Dashboard — State Machine Action Queue

The dashboard renders the state machine directly. One primary number, four action buckets, one CTA per bucket.

```
┌──────────────────────────────────────────────────┐
│  💰 $1,587 available to reclaim                  │
│  (sum of ELIGIBLE + NEEDS RECEIPT)               │
├──────────────────────────────────────────────────┤
│  🧾 NEEDS RECEIPT        3 expenses  |  $284     │
│  "Attach receipts before you forget" [Attach →]  │
├──────────────────────────────────────────────────┤
│  👁 PENDING REVIEW       5 expenses  |  $612     │
│  "Confirm these are HSA-eligible"    [Review →]  │
├──────────────────────────────────────────────────┤
│  ✅ READY TO SUBMIT       4 expenses  |  $691     │
│  "Generate your Substantiation Record" [Submit →]│
├──────────────────────────────────────────────────┤
│  ⏳ SUBMITTED             2 expenses  |  $347     │
│  "Waiting for HSA deposit"           [Track →]   │
└──────────────────────────────────────────────────┘
```

**Shoebox users:** ELIGIBLE bucket shows as "📦 Shoebox Balance — Saved for future reimbursement." No submission CTA.

**Empty state:** "You're all caught up — $1,240 reclaimed this year." Never an empty void.

---

## 9. Navigation (5 Primary Tabs)

```
📊 Dashboard       ← state machine action queue (home)
🧾 Expenses        ← unified bills + transactions timeline (renamed from "Bills")
💳 Transactions    ← secondary filter within Expenses (not primary nav)
📦 Expense Groups  ← collections (renamed from "Care Events")
📄 Substantiation  ← reimbursement requests + export
```

Settings, Reports, Documents, Bank Accounts, Calculator → overflow/secondary menu.

**Unified Expenses view:** One row per real-world event. Matching between Plaid transactions and bills happens silently. Users never see "reconcile," "match," "invoice," or "transaction." When matching fails, it surfaces in the dashboard action queue as plain-language: _"Was the $87 charge at Dental Associates the same as your March bill? [Yes] [No]"_

---

## 10. Notifications (Exactly 3 Types)

1. **Plaid trigger** — fires within minutes of a medical MCC transaction. _"We saw a $52 charge at Walgreens — was this a medical expense? [Yes, attach receipt] [No, skip]"_ Deep-links to receipt scan flow.

2. **Receipt decay nudge** — fires once per week if NEEDS RECEIPT bucket is non-empty. _"You have 3 expenses with missing receipts. Snap them before they're hard to find."_

3. **Monthly submission reminder** — fires once per month if ELIGIBLE bucket is non-empty for >14 days. _"You have $691 ready to submit for HSA reimbursement."_ **Suppressed for shoebox users.**

No streak notifications. No generic nudges. No contribution limit reminders.

---

## 11. Pricing

| Tier        | Price            | Key Gate                                                                                                                           |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Free**    | $0               | Manual entry, receipt scanning (5/mo), 1 Plaid account, basic tracking                                                             |
| **Plus**    | $12.99–$14.99/mo | Unlimited scanning, unlimited Plaid, AI eligibility, **Substantiation Record**, historical import, Expense Groups, patient tagging |
| **Premium** | $19.99/mo        | All Plus + HSA investment optimization, priority support, custom reports                                                           |
| **Annual**  | $99/yr           | Plus features at ~$8.25/mo — **primary CTA on pricing page**                                                                       |

The Substantiation Record is the paywall. Free users can track and scan; they cannot generate the document that protects them in an audit.

---

## 12. Competitive Positioning

| Competitor                       | Key Weakness                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| Lively, HealthEquity, Optum apps | Only works with their own HSA custodian                         |
| Bend                             | Forces custodian switch                                         |
| Expensify / Wave                 | Not HSA-aware, no eligibility engine, no Substantiation Record  |
| Spreadsheets + shoebox           | The real competition — Reclaim is the tool they should be using |

**Three differentiators:**

1. Custodian-agnostic — works with any HSA
2. IRS eligibility determination — not just categorization
3. Substantiation Record — a document no competitor produces

---

## 13. Go-To-Market

**Beta (Weeks 1–6):** Invite 5–10 LinkedIn/personal network contacts. Phases 1–4 complete. Rough edges acceptable.

**Broader Beta (Weeks 7–12):** Reddit post in r/personalfinance, r/financialindependence, r/hsa. _"I built a tool that scans your last 2 years of transactions and finds your unclaimed HSA reimbursements — looking for beta testers."_ Target 50–100 users.

**Public Launch (September 1, 2026):** All 6 phases complete. Plaid production access live. Supabase BAA signed.

**Success Metric:** 10 users have generated at least one Substantiation Record.

---

## 14. Product Analytics (5 Metrics)

Tooling: **PostHog** (free tier, session recordings, funnel analysis).

| Metric                                                         | Signal                                |
| -------------------------------------------------------------- | ------------------------------------- |
| % new users who review ≥1 historical transaction within 7 days | Onboarding activation                 |
| Substantiation Records generated per week                      | **North star — core loop completion** |
| Expenses in NEEDS RECEIPT >14 days                             | Capture friction                      |
| Plaid connection rate (% of signups)                           | Capture adoption                      |
| Week 4 retention                                               | Habit formation                       |

---

## 15. Email (3 Transactional, via Resend)

| Trigger                               | Email                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| Signup                                | Welcome — "Here's how to get your first Substantiation Record." One CTA: connect Plaid. |
| Plaid connected + transactions found  | "We found X transactions that may be HSA-eligible — review them now."                   |
| First Substantiation Record generated | "Your first Substantiation Record is ready 🎉 — here's what to do with it."             |

---

## 16. Support

**In-app feedback widget** — floating button, captures current page URL + user ID + free text. Prompt: _"What were you trying to do?"_ Routes to `support@reclaim.health`.

---

## 17. Compliance

- **HIPAA posture:** "Built with healthcare-grade security practices." Not formally HIPAA-compliant. Do not market as such.
- **Supabase BAA:** Sign before any real user health data is stored (Supabase Pro plan).
- **AI/OCR:** Evaluate OCR provider for BAA coverage before handling PHI in receipts.
- **Plaid tokens:** AES-256-GCM encrypted at rest. Legacy plaintext column already dropped.

---

## 18. V1 Build Plan — 6 Phases, 15 Weeks (Launch: September 1, 2026)

### Phase 1 — Foundation (Weeks 1–2)

1. Expand expense state machine schema — add PENDING REVIEW, ELIGIBLE, INELIGIBLE, NEEDS RECEIPT states to existing `invoices.status`
2. Patient tagging — `patient_name` field (Self / Spouse / Dependent) on all expenses
3. HSA strategy preference on user profile — "Reimburse regularly" vs. "Shoebox method"
4. Basic CRUD for expenses in all states

### Phase 2 — Capture (Weeks 3–5)

5. OCR UX redesign — camera-first on mobile; persist results to `receipt_ocr_data`
6. Plaid transaction webhook → CAPTURED state; MCC-based medical detection
7. Historical Plaid import — 12–24 months pulled immediately on first account connection (activation event)
8. Manual expense entry as fallback

### Phase 3 — Classification (Weeks 6–8)

9. IRS Pub 502 eligibility database in Supabase — server-side, updatable without app release
10. AI classification on CAPTURED expenses → PENDING REVIEW with confidence score
11. User confirmation flow → ELIGIBLE or INELIGIBLE; explicit confirmation = audit trail

### Phase 4 — Output (Weeks 9–10)

12. Substantiation Record — IRS-style as primary (patient name, date of service, provider, amount, Pub 502 basis, receipt image, Reclaim confirmation timestamp). Also: per-expense packet PDF, simple PDF, CSV
13. SUBMITTED state — set when user generates a Substantiation Record
14. Plaid deposit detection → prompt user → REIMBURSED state close

### Phase 5 — Surface (Weeks 11–12)

15. Dashboard redesign — state-machine action queue (see Section 8)
16. Unified Expenses view — replace Bills + Transactions split (see Section 9)
17. Navigation redesign — 5 primary tabs (see Section 9)
18. Push notifications — exactly 3 types (see Section 10)
19. PWA mobile-first pass — 390px primary canvas, verify iOS push notifications

### Phase 6 — Launch Prep (Weeks 13–14 + Week 15 buffer)

20. Onboarding wizard — signup → dependents → Plaid connection → wow moment → paywall. Paywall appears _after_ wow moment.
21. Supabase BAA — sign before any real user health data is stored
22. Pricing update — add annual plan ($99/yr) as primary CTA; update Plus to $12.99–$14.99/mo
23. Landing page complete rewrite — Reclaim positioning, Substantiation Record as hero feature, remove fake testimonials, remove HIPAA compliance claim, remove non-functional feature claims, embed Shoebox Calculator as free tool
24. Support infrastructure — `support@reclaim.health`, in-app feedback widget
25. Analytics setup — PostHog, instrument 5 key events
26. Remove tripwire flow — archive TripwireOffer, TripwireSuccess, create-tripwire-checkout
27. Dead code removal — orphaned pages (~3,500 LOC), provider transparency frontend, archived dispute/bill review, unused edge functions. Target: 30–40% reduction in components directory
28. Rebrand: Wellth.ai → Reclaim throughout codebase, PWA manifest, Stripe, Google OAuth, Supabase project name
29. 3 transactional emails via Resend (see Section 15)

---

## 19. Immediate Action Items (Before Writing Any Code)

- [ ] **Email Plaid today** — notify of upcoming rebrand from Wellth.ai → Reclaim before application processes. Reference `developer-relations@plaid.com`
- [ ] **Check Plaid Development environment** — may allow real account connection today without production approval
- [ ] **Sign Supabase BAA** — 30 minutes on Pro plan; unblocks real user data handling
- [ ] **Secure `reclaim.health` domain**
- [ ] **Set up `support@reclaim.health`** email routing

---

## 20. V1.1 Backlog (Do Not Start Until V1 Ships)

- HSA custodian direct sync (balance + distribution history)
- EOB matching and parsing
- Wellbie as document explainer (EOB translation + HSA-eligible amount)
- Year-end FSA spending alerts
- HSA investment optimization (Premium tier)
- Care event / Expense Group auto-suggestions on steroids
- IRS Audit Support Package — premium one-time upsell (~$49) triggered after first Substantiation Record generated
- Multi-HSA household accounts (two spouses each with their own HSA)

---

## 21. Known Issues / Technical Debt (Address in Phase 6)

- `PrePurchaseDecision` "Enter Expense Now" navigates to `/expenses/new` — route does not exist in App.tsx. Broken handoff.
- Naming inconsistency: UI says "expenses" / table is `invoices`; UI says "Care Events" / table is `collections`. Canonicalize before launch.
- `receipt_ocr_data` extended columns (`invoice_number`, `insurance`, `service_date`, `metadata_confidence`, etc.) exist but nothing writes to them.
- `wellbie_attachments` table exists but no frontend wiring.
- `expense_decisions` table written to by PrePurchaseDecision but the "apply" CTA leads to a broken route.

---

_Last updated: 2026-05-21_  
_This document should be updated whenever a significant product decision is made._
