# Competitive Analysis — Reclaim (HSA receipt / reimbursement app)

**Report date: 2026-06-16.** All competitor findings are point-in-time, gathered via live
web research on this date; pricing, features, ratings, and traction change frequently.
Every external factual claim carries a source URL. Where a fact could not be verified it is
marked **"Not found"** rather than guessed. Claims about **Reclaim itself are grounded in
this repository's code**; statements are labeled _(code-proven)_ vs _(inferred / assumed)_.

---

## a. Product Profile (as-built) — Reclaim (formerly Wellth.ai)

Derived from the codebase, not marketing copy. Each feature is tagged **SHIPPED**
(implemented + wired into routes/UI), **PARTIAL** (built but flag-gated or incomplete), or
**PLANNED / ABSENT** (referenced but not built, or deliberately removed).

### Core value proposition & primary job _(code-proven)_

Reclaim turns medical spending into **IRS-defensible HSA reimbursement records**. The
primary user job: _"prove to the IRS that my HSA withdrawals were for qualified medical
expenses — and capture every dollar I'm owed."_ The flow is: capture an expense → AI
classifies it against IRS Pub 502 → the user **explicitly confirms** eligibility → the app
generates an audit-ready **Substantiation Record** with contemporaneous confirmation
timestamps → Plaid detects the matching reimbursement deposit and closes the loop. It
explicitly supports the **"shoebox strategy"** (leave the HSA invested, reimburse yourself
years later) via a `reimbursement_strategy_preference` on the profile and a dashboard
"Available to Reclaim" balance.

### Feature set

**SHIPPED**

- **Receipt OCR capture** — Vertex AI Gemini extracts vendor/amount/date/category/eligibility.
  `supabase/functions/process-receipt-ocr/index.ts`, `src/components/bills/BillUploadWizard.tsx`.
- **Manual entry** (`src/pages/ExpenseEntry.tsx`) and **CSV bulk import** (`src/pages/BulkImport.tsx`).
- **Plaid bank linking + 18-month historical import + MCC-based medical auto-capture** —
  `src/components/PlaidLink.tsx`, `supabase/functions/plaid-create-link-token|exchange-token|sync-transactions|webhook`, `_shared/medicalClassifier.ts`.
- **AI Pub 502 eligibility classification + rule catalog** (~80 seeded rules with section
  refs, confidence, reasoning, warnings) — `supabase/functions/classify-expense/index.ts`,
  `_shared/expenseClassifier.ts`, `pub_502_rules` table; reference catalog page
  `src/pages/HSAEligibility.tsx`.
- **Lifecycle state machine** (`captured → pending_review → eligible/ineligible/needs_receipt
→ submitted → reimbursed`) where the transition to `eligible` **requires explicit user
  confirmation** — the deliberate "audit-trail moat."
- **Substantiation Record generation** — client-side PDF/CSV with embedded receipts and a
  defensibility statement citing IRC §213(d) / IRS Pub 969 — `src/lib/substantiationRecord.ts`,
  `src/pages/Substantiation.tsx`, `substantiation_records` / `substantiation_record_items` tables.
- **Closed-loop reimbursement** — Plaid-detected deposits matched to record totals (exact
  amount ±$0.01, 90-day window) cascade invoices to `reimbursed` — `_shared/depositMatcher.ts`,
  `reimbursement_match_candidates` table.
- **Tax package export** (`src/lib/taxReportGenerator.ts`, `TaxPackageExport.tsx`) and an
  **analytics dashboard** (YoY, benchmarking, HSA investment tracker) — `src/pages/Reports.tsx`.
- **Collections / care-event grouping**; **dashboard action queue** (4 buckets: needs
  receipt / pending review / ready to submit / submitted).
- **Stripe subscriptions** with render-time **feature gating** — `src/contexts/SubscriptionContext.tsx`,
  `src/components/subscription/FeatureGate.tsx`.
- **Supabase auth** (email/password + Google OAuth); **PWA** (installable, offline-capable,
  `vite.config.ts` VitePWA).

**PARTIAL**

- **Wellbie conversational AI assistant** — fully coded, with DB tables, but disabled by
  default (`FF.WELLBIE_ENABLED=false`, deferred to v1.1) — `src/lib/featureFlags.ts`.
- **Hospital pricing transparency** — `fetch-hospital-pricing` edge function exists; no UI wired.
- **HSA custodian "integration"** — curated custodian dropdown + manual reimbursement-
  instruction PDFs only. **No custodian API.** — `src/components/ledger/ClaimHSADialog.tsx`,
  `src/lib/pdfGenerator.ts`.

**PLANNED / ABSENT**

- **Email-forward receipt capture** — not implemented (no inbound receipt mailbox).
- **Retailer / Amazon receipt parsing** — not implemented.
- **Bill dispute / negotiation + provider directory** — archived to `src/_archived/` (V2 scope).
- **Native iOS / Android apps, browser extension** — absent; the PWA is the mobile story.

### Integrations confirmed in code _(code-proven)_

Plaid (sandbox/prod configurable), Stripe (price IDs hardcoded in `create-checkout`),
Google Vertex AI Gemini (service-account OAuth2, BAA-eligible path), Supabase
(Postgres / Auth / Storage / Edge Functions). **No** HSA custodian API, **no** accounting
tool (QuickBooks/Xero), **no** retailer integration.

### Monetization _(code-proven, with one flagged discrepancy)_

Three Stripe tiers — free / plus / premium — with tier re-checked every 60s and gating
**enforced at render** via `<FeatureGate requiredTier=…>`. **Pricing discrepancy:**
`src/components/Pricing.tsx` displays **Plus $19/mo and Premium $49/mo**, while `README.md`
and `CLAUDE.md` state **Plus $9.99/mo and Premium $19.99/mo**. Per direction, this report
treats the **docs figures ($9.99 / $19.99) as canonical** and flags the component mismatch
as something to reconcile in code before launch.

### Platforms & maturity _(code-proven / inferred)_

Web SPA + PWA only (no native, no extension). Deployed at `reclaim.health` (legacy
`wellth-ai.app` still in CORS allowlists). Maturity: ~6-phase build largely complete, zero
TODO/FIXME in `src/`, comprehensive docs, but minimal automated tests and no CI workflow
found. The Wellth→Reclaim rebrand is _(inferred)_ ~85–90% complete (stale legal-contact
emails, PDF URLs, and localStorage keys remain).

### Security & compliance posture _(code-proven; gaps are observations, not an audit)_

AES-256-GCM encryption of Plaid tokens (`_shared/encryption.ts`); JWT validation + RLS on
edge functions and tables; whitelist CORS (no wildcard); `sanitizePHI()` / `safeLog()` PHI
redaction; GDPR-style account deletion with Plaid token revocation + cascade
(`delete-user-account`); BAA-eligible Vertex AI path for OCR. Documented HIPAA / access-
control / data-retention policies in `docs/`. **Gap observations:** frontend PHI logging is
dev-only; receipt images in Supabase Storage rely on platform (not app-layer) encryption;
the unused `redact-phi` function has stale wildcard-ish CORS. A formal third-party audit is
not evidenced in the repo.

### Questions the code can't answer (for you)

1. Is the live Stripe catalog actually $9.99/$19.99, or the $19/$49 in `Pricing.tsx`? (Code
   conflicts; resolve before the pricing section is acted on.)
2. Is the go-to-market purely self-serve B2C, or is an employer/custodian (B2B2C) channel
   intended? (Code shows only consumer Stripe checkout. Framed below as B2C-now / B2B2C-upside.)
3. Has a HIPAA BAA actually been signed with Google Cloud, and any SOC 2 effort started?
   (Code is BAA-_ready_; the legal/operational status isn't in the repo.)

---

## b. Executive summary

The HSA receipt-tracking niche is **real but crowded with cheap, lightly-differentiated
B2C apps**. The market clusters into three bands: (1) bare manual web ledgers (TrackHSA,
~$2/mo); (2) AI "snap-and-store" receipt apps (HSA Tracker Pro, HSA Vault, HSA Store's free
ExpenseTracker, Shoebox); and (3) bank-sync auto-detectors (Reimbursable on Plaid; HSA Store
on shopping history; Shoebox on Amazon/email). Pricing is almost uniformly **cheap and
annual** ($0–$120/yr). The clearest **direct threats** are **Reimbursable** — same Plaid
auto-detection mechanic, explicit HSA focus, Form 8889 output, $19/yr, and an SEO content
engine — and **Shoebox** (shoebox.io), which shares Reclaim's niche _and_ the loaded
"shoebox" name, and already ships **email-forward and Amazon/Chrome-extension capture** that
Reclaim lacks. **HSA Store's ExpenseTracker** is a distribution threat (free, riding a large
retail customer base). Adjacent players (Truemed, Reclaim Health, Shoeboxed) overlap on
mechanics but serve different jobs. **Reclaim's clearest opening is defensibility, not
organization:** no competitor combines (a) explicit user-confirmed, timestamped
**Substantiation Records** built for IRS audit survival with (b) **closed-loop reimbursement**
that detects the deposit and marks the expense reclaimed. That pairing is unique in the set
and is exactly what Reclaim has already shipped — the wedge to lead with.

---

## c. Feature comparison matrix (shipped features)

Legend: ✓ = present / shipped · ✗ = absent · ~ = partial / limited · ? = unknown ·
**◐ = Reclaim PARTIAL or PLANNED** (not in the shipped baseline).
Reclaim's column reflects **SHIPPED-only**; ◐ items are called out separately.

| Capability                                         | **Reclaim (shipped)**      | Shoebox (shoebox.io)     | Reimbursable  | HSA Store ExpenseTracker | TrackHSA        | HSA Tracker Pro  | HSA Vault†       | Shoeboxed (adj)     | Reclaim Health (adj) | Truemed (adj)   |
| -------------------------------------------------- | -------------------------- | ------------------------ | ------------- | ------------------------ | --------------- | ---------------- | ---------------- | ------------------- | -------------------- | --------------- |
| Target user                                        | B2C                        | B2C                      | B2C           | B2C (retail)             | B2C             | B2C              | B2C              | B2C/SMB             | **B2B**              | B2B2C           |
| HSA-specific                                       | ✓                          | ✓                        | ✓             | ✓                        | ✓               | ✓                | ✓                | ✗                   | ~ (claims)           | ~ (eligibility) |
| Manual entry                                       | ✓                          | ✓                        | ✓             | ✓                        | ✓               | ✓                | ✓                | ✓                   | n/a                  | n/a             |
| Photo / OCR capture                                | ✓                          | ✓                        | ✓             | ✓                        | ✗ (upload only) | ✓ (Pro)          | ✓                | ✓                   | n/a                  | ✗               |
| Email-forward capture                              | **◐** ✗                    | ✓                        | ?             | ✗                        | ✗               | ✗                | ✗                | ✓ (Gmail)           | n/a                  | ✗               |
| Retailer / Amazon scan                             | **◐** ✗                    | ✓ (Chrome ext)           | ✗             | ✓ (HSA Store)            | ✗               | ✗                | ✗                | ✗                   | n/a                  | ✓ (checkout)    |
| Mail-in scanning                                   | ✗                          | ✗                        | ✗             | ✗                        | ✗               | ✗                | ✗                | ✓ (Magic Envelope)  | ✗                    | ✗               |
| Bank sync (Plaid etc.)                             | ✓                          | ✗                        | ✓ (Plaid)     | ~ (shopping hist.)       | ✗               | ✗                | ✗                | ✗                   | ✓ (claims data)      | ✗               |
| Auto HSA-eligibility detect                        | ✓ (AI + Pub 502)           | ~ (AI categorize)        | ✓ (bank txns) | ✓ (barcode + history)    | ✗ (manual cat.) | ✓ (AI flag)      | ✓ (AI + scanner) | ✗                   | n/a                  | ✓ (LMN)         |
| Eligible-expense database                          | ✓ (~80 Pub 502 rules)      | ?                        | ✓ (directory) | ✓ (barcode DB)           | ~ (categories)  | ~                | ~ (scanner/quiz) | ✗                   | n/a                  | ✓ (LMN)         |
| Shoebox / investment framing                       | ✓                          | ✓                        | ✓             | ~                        | ✗               | ✓                | ✓                | ✗                   | ✗                    | ✗               |
| Explicit confirmation + timestamped substantiation | ✓ **(unique)**             | ✗                        | ~             | ✗                        | ~ (audit trail) | ~ (audit export) | ~ (audit report) | ✗                   | n/a                  | ~ (LMN doc)     |
| Closed-loop reimbursement (deposit match)          | ✓ **(unique)**             | ✗                        | ✗             | ✗                        | ✗               | ✗                | ✗                | ✗                   | ✗                    | ✗               |
| Reimbursement / distribution tracking              | ✓                          | ✓                        | ✓             | ✓                        | ✓               | ✓                | ✓                | ✗                   | n/a                  | ✗               |
| Custodian API integration                          | ✗ (manual)                 | ✗                        | ✗             | ✗                        | ✗               | ✗                | ✗                | ✗                   | ✓ (WEX etc.)         | ✗               |
| Accounting integration                             | ✗                          | ✗                        | ✗             | ✗                        | ✗               | ✗                | ✗                | ✓ (QBO/Xero)        | ?                    | ✗               |
| Tax / audit export                                 | ✓ (PDF/CSV)                | ✓ (export)               | ✓ (Form 8889) | ✓ (reports)              | ✓               | ✓ (CSV+IRS)      | ✓ (audit report) | ✓ (CSV)             | n/a                  | ✗               |
| Platforms                                          | Web + PWA                  | Web + email + Chrome ext | Web           | iOS + Android            | Web             | Web + iPhone     | Web + PWA        | iOS + Android + web | Web (employer)       | Web/merchant    |
| AI conversational assistant                        | **◐** (Wellbie, gated off) | ✗                        | ✗             | ✗                        | ✗               | ✗                | ✗                | ✗                   | ~                    | ✗               |
| Free tier                                          | ✓                          | ✓                        | ✗ (trial?)    | ✓                        | ✗ (trial)       | ✓                | ✓                | ✗ (trial)           | n/a                  | ✓               |

† HSA Vault is **my own addition** (not on your original list). See §d.

**Reclaim PARTIAL/PLANNED that would change this picture once built (◐):** email-forward
capture and retailer/Amazon scan (both shipped by Shoebox today) are the most consequential
gaps; the Wellbie assistant is built but flag-gated; a native mobile app and custodian API
remain absent.

---

## d. Competitor profiles

### DIRECT competitors

#### Shoebox — shoebox.io _(closest direct threat: same niche + same name)_

HSA-receipt-storage app explicitly built around the retirement "shoebox strategy" and the
HSA triple-tax advantage, targeting households who want to maximize unreimbursed-receipt
hoarding. Capture is unusually broad for the niche: **email-forward with AI extraction**
(Sept 2025), a **Chrome extension that scans Amazon receipts and sends real-time HSA-purchase
notifications** (Mar 2025), plus mobile and desktop/web; **multiple authorized email addresses
for household sharing** (Nov 2025). Pricing is **Free + Plus at $60/yr (early-adopter, "50%
off indefinitely") or $120/yr standard, 30-day trial**. It advertises "unlimited AI-assisted
categorization," "IRS tax preparation & audit protection," and a "full library export"
guarantee. ([shoebox.io](https://www.shoebox.io/), [changelog via shoebox.io](https://www.shoebox.io/))

- **SWOT — Strengths:** broadest capture surface in the niche (email + Amazon/Chrome +
  mobile) ([changelog](https://www.shoebox.io/)); retirement/triple-tax narrative aligned to
  the highest-value HSA users ([shoebox.io](https://www.shoebox.io/)); same "shoebox" word as
  the strategy aids SEO.
- **Weaknesses:** no bank-sync/Plaid auto-detection mentioned ([shoebox.io](https://www.shoebox.io/));
  eligibility logic undocumented ("AI-assisted" only); **native iOS/Android app — Not found**;
  funding/traction — **Not found** (public "Shoebox" funding records refer to an unrelated
  2012 photo-backup app, not this HSA product).
- **Opportunities:** retailer expansion beyond Amazon (stated roadmap).
- **Threats (to them):** trivially commoditized by HSA Store's free, retail-backed app and by
  Plaid-based detectors like Reimbursable/Reclaim.

#### Reimbursable — reimbursable.com _(mechanically the closest to Reclaim)_

Positions as "the only app built specifically for HSA expense tracking." **Connects HSA /
credit / checking accounts via Plaid and automatically finds out-of-pocket medical expenses
eligible for reimbursement**, turning each into an editable record and **auto-populating IRS
Form 8889**. Pricing: **DIY $19/yr** (unlimited entries, bank integration, receipt storage,
Form 8889) and **Full Service $29/mo** (adds a virtual assistant, monthly spending reports,
quarterly reconciliation). It also runs an HSA/FSA eligible-items **directory** and a
"10 best receipt apps" **content/SEO blog**. ([reimbursable.com search result](https://www.google.com/search?q=reimbursable.com+hsa),
[reimbursable.com/hsa-reimbursement-tracker](https://reimbursable.com/hsa-reimbursement-tracker),
[reimbursable.com](https://reimbursable.com/))

- **SWOT — Strengths:** Plaid auto-detection + Form 8889 is the strongest _automated_ HSA
  story among direct rivals; cheap DIY tier; SEO/content flywheel; an **assisted "Full
  Service" tier Reclaim has no answer to**.
- **Weaknesses:** no closed-loop deposit matching; receipt OCR depth unclear; platform appears
  **web-only** (native app — Not found); eligibility detection is bank-transaction-based, not a
  documented Pub 502 rule engine.
- **Opportunities / Threats:** owns much of the HSA-tracking SEO surface; could add deposit
  matching and erase Reclaim's loop-closure edge.

#### HSA Store ExpenseTracker — hsastore.com (Health-E Commerce) _(distribution threat)_

Free iOS + Android app from **Health-E Commerce** (parent of HSA Store, FSA Store, Caring
Mill). **Auto-detects HSA-eligible purchases from shopping history, scans receipts via photo,
scans barcodes to check product eligibility, organizes by plan year, auto-files HSA Store
purchases, and generates reimbursement/tax reports.** Updates announced Nov 3, 2025.
([PR Newswire, 2025-11-03](https://www.prnewswire.com/news-releases/still-saving-paper-receipts-in-a-shoebox-simplify-your-tax-free-health-savings-account-hsa-funds-with-the-hsa-expensetracker-app-from-hsa-store-302602816.html),
[health-ecommerce.com](https://www.health-ecommerce.com/post/hsa-store-launches-expense-tracker-app-to-help-track-hsa-expenses))

- **SWOT — Strengths:** **free**; native mobile; **barcode eligibility database**; built-in
  distribution to HSA Store's large, in-market customer base; trusted retail brand.
- **Weaknesses:** fundamentally a **lead-gen funnel for the retail store**; no bank-sync/Plaid;
  no audit-defensibility record beyond reports; tied to its own retail ecosystem.
- **Threat:** its free price + distribution makes it the price/UX floor of the category.

#### TrackHSA — trackhsa.com

Long-running, **web-only manual record-keeper**: create a transaction (date, provider,
description, amount), upload unlimited receipts (images + PDF/Word), see unreimbursed totals,
and generate audit documentation via Overview / Receipts / **Audit Trail** tabs.
**Manual entry only — no bank sync.** Pricing **$2/mo after a 30-day trial** (Stripe). Security:
SSL + Google-managed servers. ([trackhsa.com/features](https://www.trackhsa.com/features),
[trackhsa.com](https://trackhsa.com/))

- **SWOT:** _Strengths_ — cheapest paid option, simple, established, explicit audit-trail
  framing. _Weaknesses_ — fully manual, **web-only**, no OCR, no AI, no bank sync, dated UX.
  Third-party commentary frames dedicated tools like this as fine but effortful vs provider
  tools/spreadsheets. ([White Coat Investor](https://www.whitecoatinvestor.com/the-best-way-to-track-your-hsa-receipts/))

#### HSA Tracker Pro — hsatrackerpro.com (App Store id6759116912)

**Web + native iPhone** app built around the "deferral strategy" (pay out-of-pocket, keep HSA
invested). **Pro AI receipt scanning:** "Snap a photo. AI extracts merchant, date, amount, and
category — and flags HSA eligibility." Family management, EOB attachment, growth projections,
encrypted 7+ yr receipt storage, CSV + IRS-formatted exports. Tiers: **Free / Basic $24/yr /
Pro $36/yr.** Self-reported **"4.9 stars, 2,000+ users."** ([hsatrackerpro.com](https://hsatrackerpro.com/),
[App Store](https://apps.apple.com/us/app/hsa-tracker-pro/id6759116912))

- **SWOT:** _Strengths_ — native iPhone app, AI extraction + eligibility flag, family support,
  growth projections, cheap, strong (self-reported) rating. _Weaknesses_ — **no bank sync, no
  Android**, no closed-loop reimbursement, traction self-reported (not independently verified).

#### HSA Vault — hsavault.app _(my addition)_

AI receipt manager launched 2024. **AI extracts provider, amount, CPT codes, and category**;
adds an "Eligibility Scanner" and a 60-second "HSA Compliance Quiz." **Free** (25 AI scans/yr,
unlimited manual) / **Pro $19/yr** (unlimited AI + audit-report export). **PWA** for iPhone +
Android (no app-store download), offline-capable; **AES-256 at rest, TLS 1.3 in transit on
AWS**. Bank integrations — Not found. ([hsavault.app](https://hsavault.app/))

- **SWOT:** _Strengths_ — AI + CPT-code extraction, compliance-quiz hook, strong stated
  encryption, cheap, **same PWA distribution model as Reclaim**. _Weaknesses_ — no bank sync,
  no closed loop, no independent ratings found.

### ADJACENT competitors (overlap mechanics, different primary job)

#### Shoeboxed — shoeboxed.com

General-purpose **SMB receipt scanning + mileage tracking**, _not HSA-specific_. Capture via
iOS/Android app, the **"Magic Envelope" mail-in service with human verification**, and Gmail
sync. Integrates with **QuickBooks Online, Xero, Wave, Evernote, Dropbox, CSV**. Pricing:
**Starter $9/mo ($97/yr) · Pro $29/mo ($297/yr) · Plus $79/mo · Paper Plus $179/mo**, 30-day
money-back. ([shoeboxed.com/pricing](https://www.shoeboxed.com/pricing),
[shoeboxed.com/features](https://www.shoeboxed.com/features))

- **SWOT:** _Strengths_ — mature, accounting integrations, unique mail-in digitization, native
  apps. _Weaknesses_ — **no HSA eligibility/reimbursement features**; priced for businesses, not
  HSA consumers. Relevant mainly to the **naming** discussion (Shoebox vs Shoeboxed).

#### Reclaim Health — reclaimhealth.com _(B2B; direct name + sector collision)_

**B2B healthcare-financial-advocacy platform** for self-insured employers (2,000+ employees).
AI reviews 100% of claims for errors/overcharges, files appeals, and recommends benefit
optimizations across HSA/FSA/HRA. Traction: **"1.75M+ families at 100+ self-funded employers,"**
partners **WEX, Securian, Empyrean**, "$6.3M back per 10,000 employees," 2026 AI Excellence
Award. ([reclaimhealth.com](https://www.reclaimhealth.com/))

- **SWOT:** _Strengths_ — funded/real B2B traction, custodian/benefits partnerships, employer
  distribution. _Weaknesses_ — not a consumer receipt tracker; touches HSAs only as one line in
  benefits optimization. **Most significant as the "Reclaim" brand collision** in healthcare and
  as proof a B2B2C channel exists.

#### Truemed — truemed.com _(B2B2C eligibility-at-checkout)_

**Payment facilitator** that makes wellness purchases HSA/FSA-eligible via a **Letter of
Medical Necessity** issued by independent clinicians ("90% of LMNs within 7 hours"). **1.5M+
users**; integrated into checkout for brands like **Peloton, AG1, Garmin, Purple, ClassPass**.
([truemed.com](https://www.truemed.com/))

- **SWOT:** _Strengths_ — large user base, marquee merchant partners, owns the _point-of-sale
  eligibility_ moment. _Weaknesses_ — does **not** track receipts or generate reimbursement
  records; different job entirely. Possible **partner**, not direct competitor.

### NAMING-ONLY collision (excluded from feature comparison)

#### Reclaim.ai — reclaim.ai

**AI calendar / scheduling automation** for individuals and teams (focus time, meetings,
tasks, habits; syncs Google/Outlook; integrates Slack, Zoom, Asana, Jira). Free "Lite" + paid
Starter/Business/Enterprise. **No relationship to healthcare or HSAs** — same word, unrelated
category. ([reclaim.ai](https://reclaim.ai/))

### Other notable apps found _(my additions, lighter verification)_

- **HSA Trackr — hsatrackr.com:** free + pro plans; publishes shoebox-strategy guides (SEO).
  ([hsatrackr.com/pricing](https://www.hsatrackr.com/pricing), [guide](https://www.hsatrackr.com/guides/hsa-shoebox-strategy))
- **HSAHub — hsahub.us:** "smart receipt tracking for HSA reimbursements"; pricing page
  blocked at fetch time — **details Not found**. ([hsahub.us/pricing](https://hsahub.us/pricing))
- **HSA Monster: Receipt Saver AI** — iOS AI receipt saver. ([App Store](https://apps.apple.com/app/id6757624949))
- **HSA Orbit — hsaorbit.com:** HSA contribution-tracking tools/content (adjacent, not a
  receipt tracker). ([hsaorbit.com](https://www.hsaorbit.com/articles/best-hsa-contribution-tracking-apps))

The volume of near-identical low-priced apps confirms a **crowded, commoditizing long tail**.

---

## e. Positioning analysis

**Where competitors cluster.** Three crowded bands and two adjacent ones:

1. **Manual web ledgers** — TrackHSA, HSAHub. Cheap, simple, effortful, web-only.
2. **AI "snap-and-store" apps** — HSA Tracker Pro, HSA Vault, HSA Store ExpenseTracker,
   Shoebox, HSA Monster. The fight here is OCR quality + eligibility flagging + price, and it
   is **commoditizing fast** (free tiers everywhere, $19–36/yr paid).
3. **Bank-sync auto-detectors** — Reimbursable (Plaid), HSA Store (shopping history), Shoebox
   (Amazon/email). Fewer players; higher technical bar. **Reclaim lives here** (Plaid + MCC).
4. **Adjacent** — Truemed (point-of-sale eligibility) and Reclaim Health (B2B claims advocacy):
   different jobs, potential partners, not head-to-head.

**Crowded vs underserved.** _Crowded:_ receipt OCR, manual entry, plan-year organization, CSV
exports, cheap annual pricing, shoebox-strategy marketing copy. _Underserved:_ (a) **defensible,
contemporaneous substantiation** — most apps store receipts and export reports, but few build a
record explicitly designed to _survive an IRS audit_ with a confirmation timestamp and a cited
rule; (b) **closing the reimbursement loop** — every competitor stops at "export/record"; none
verify the money actually arrived; (c) **rule-grounded eligibility explanation** — competitors
offer "AI categorization" (Shoebox, HSA Tracker Pro) or a category dropdown (TrackHSA) rather
than a transparent Pub 502 rule + section reference.

**Differentiation opportunities (grounded in shipped code):**

1. **Own "audit-proof," not "organized."** Reclaim's user-confirmed, timestamped Substantiation
   Record citing IRC §213(d)/Pub 969 (`src/lib/substantiationRecord.ts`) is **unique in this
   set**. Lead the brand with audit survival, not receipt storage.
2. **Own closed-loop reimbursement.** The Plaid deposit-match → "reimbursed" cascade
   (`_shared/depositMatcher.ts`) is a feature **no competitor has**. "We tell you when your
   money actually lands" is a concrete, demonstrable hook.
3. **Make Pub 502 transparency a trust signal.** Surface _why_ something is eligible (rule name
   - IRS section + reasoning), which the ~80-rule catalog already supports — a credibility edge
     over opaque "AI categorization."
4. **Full-funnel capture as a moat.** Reclaim already combines **Plaid auto-capture + OCR +
   manual + CSV** in one product; only Reimbursable matches the Plaid leg. Marketed together
   this is a breadth advantage — _once the email/retailer gaps (◐) are closed._
5. **B2B2C wedge.** Reclaim Health proves employers and custodians (WEX, Securian, Empyrean) pay
   for healthcare-cost tooling. Reclaim's substantiation + loop-closure engine could be packaged
   as an HSA-custodian-distributed employee benefit — the channel the consumer long tail can't
   reach. _(This is the B2B2C upside on top of today's B2C build.)_

**Where NOT to compete:** don't try to out-cheap the $0–$36/yr AI snap-and-store tier, don't
chase mail-in scanning (Shoeboxed's niche), and don't build a generic SMB/accounting receipt
product.

---

## f. Pricing landscape

| Product                       | Model                      | Headline price                                              | Notes                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reclaim (docs, canonical)** | Subscription (monthly)     | **Plus $9.99/mo · Premium $19.99/mo** (~$120 / $240 per yr) | Free tier exists. **Code conflict:** `Pricing.tsx` shows $19/$49/mo (~$228/$588/yr).                                                                                                                                                   |
| Shoebox                       | Freemium annual            | $60/yr (early) · $120/yr std                                | 30-day trial ([shoebox.io](https://www.shoebox.io/))                                                                                                                                                                                   |
| Reimbursable                  | Annual + assisted monthly  | DIY **$19/yr** · Full Service **$29/mo**                    | Plaid + Form 8889 ([reimbursable.com](https://reimbursable.com/hsa-reimbursement-tracker))                                                                                                                                             |
| HSA Store ExpenseTracker      | Free                       | **$0**                                                      | Retail-funded ([PR Newswire](https://www.prnewswire.com/news-releases/still-saving-paper-receipts-in-a-shoebox-simplify-your-tax-free-health-savings-account-hsa-funds-with-the-hsa-expensetracker-app-from-hsa-store-302602816.html)) |
| TrackHSA                      | Subscription               | **$2/mo** (~$24/yr)                                         | Manual, web-only ([trackhsa.com](https://www.trackhsa.com/features))                                                                                                                                                                   |
| HSA Tracker Pro               | Freemium annual            | Free · Basic $24/yr · Pro **$36/yr**                        | Native iPhone ([hsatrackerpro.com](https://hsatrackerpro.com/))                                                                                                                                                                        |
| HSA Vault                     | Freemium annual            | Free · Pro **$19/yr**                                       | PWA ([hsavault.app](https://hsavault.app/))                                                                                                                                                                                            |
| Shoeboxed (adj)               | Subscription               | $9–$179/mo                                                  | SMB, not HSA ([shoeboxed.com](https://www.shoeboxed.com/pricing))                                                                                                                                                                      |
| Reclaim Health (adj)          | B2B (employer-paid)        | Not public                                                  | ([reclaimhealth.com](https://www.reclaimhealth.com/))                                                                                                                                                                                  |
| Truemed (adj)                 | Merchant-side facilitation | Free to consumer                                            | ([truemed.com](https://www.truemed.com/))                                                                                                                                                                                              |

**Implication.** The HSA-tracking market prices **annually and cheaply: $0–$120/yr**, with the
sole exception being Reimbursable's _assisted, human-in-the-loop_ Full Service at $29/mo.
Reclaim's canonical docs pricing — **$9.99/mo Plus ($120/yr) ties Shoebox's top price**, and
**$19.99/mo Premium ($240/yr) is ~2× the most expensive self-serve HSA competitor**. The live
`Pricing.tsx` figures ($228 / $588 per yr) would be far outside the market entirely. Two takeaways:
(1) **Reconcile the code/docs price discrepancy before launch.** (2) **Monthly framing fights
the category's annual norm** and makes Reclaim look 5–10× pricier in side-by-side comparisons.
Either move to **annual pricing** to compare like-for-like, or **explicitly justify the premium**
with the two things no rival has (audit-defensible substantiation + closed-loop reimbursement) —
ideally bundling an assisted/concierge tier to compete with Reimbursable's Full Service rather
than with the $19/yr DIY floor.

---

## g. Naming / trademark note _(context, not legal advice)_

- **"Shoebox" is the generic strategy term.** The "HSA shoebox strategy" (pay out-of-pocket,
  hoard receipts, reimburse later) is widely used and descriptive
  ([servetwealth.com](https://www.servetwealth.com/blog/the-power-of-the-health-savings-account-and-shoebox-strategy),
  [hsatrackr.com](https://www.hsatrackr.com/guides/hsa-shoebox-strategy)). A product named
  "Shoebox" is hard to protect and easy to confuse.
- **Shoebox (shoebox.io) vs Shoeboxed (shoeboxed.com).** Nearly identical names in overlapping
  "receipt" space — one HSA-specific, one SMB. Real consumer-confusion risk between them, and a
  search-result minefield (public "Shoebox" funding/company records even point to an unrelated
  2012 photo-backup app of the same name). This is _their_ problem, but it muddies the niche.
- **"Reclaim" collisions.** Three distinct "Reclaim" products: **your Reclaim** (HSA receipts),
  **Reclaim Health** (B2B healthcare claims advocacy — _same word + same broad sector_), and
  **Reclaim.ai** (AI calendar — unrelated). The Reclaim Health overlap is the notable one: both
  are healthcare-financial products, raising confusion and potential search/trademark contention,
  especially if you pursue the B2B2C/employer channel where Reclaim Health already operates.
- **Takeaway (non-legal):** "Reclaim" is descriptive in a reimbursement context (you _reclaim_
  your money) — memorable but crowded in healthcare. Worth a formal trademark/clearance search
  (esp. vs Reclaim Health) before heavy brand investment. This is informational only.

---

## h. Recommendations (prioritized)

**Lead with the sharpest wedge — audit-defensibility + closed-loop reimbursement.**

1. **Position #1: "The only HSA app built to survive an audit — and to confirm you got paid
   back."** Both halves are already shipped and **unique in this competitive set**
   (Substantiation Records + Plaid deposit matching). This is the message no competitor can copy
   quickly. Make it the homepage headline and the demo.
2. **Close the two visible capture gaps fast (PARTIAL/PLANNED → SHIPPED).** Prioritize
   **email-forward receipt capture** first (Shoebox and Shoeboxed already have it; it's table
   stakes and relatively cheap), then **retailer/Amazon capture** (Shoebox's Chrome extension and
   HSA Store's barcode flow set the bar). These are the gaps prospects will notice in a bake-off.
3. **Reconcile and reframe pricing.** Fix the `Pricing.tsx` vs docs discrepancy, switch to
   **annual pricing** to sit honestly next to a $0–$120/yr market, and consider an **assisted/
   concierge tier** to compete with Reimbursable's $29/mo Full Service rather than racing the
   $19/yr DIY floor.
4. **Turn Pub 502 classification into visible proof.** Expose rule name + IRS section + reasoning
   in the UI and in marketing ("see _why_ it's eligible"), differentiating from opaque "AI
   categorization." Low effort, high trust payoff — the catalog already exists.

**Where to compete:** the **bank-sync + audit-defensibility** lane (vs Reimbursable, Shoebox,
HSA Store), and an eventual **B2B2C custodian/employer channel** (the underserved space Reclaim
Health validates). **Where not to compete:** the commoditized $0–$36/yr snap-and-store tier on
price; mail-in scanning; generic SMB/accounting receipts.

**Which PARTIAL/PLANNED to prioritize to win:** (1) email-forward capture, (2) retailer/Amazon
capture, (3) **then** decide on the Wellbie assistant (built but gated) — it's a _nice-to-have_
that won't move the competitive needle the way capture-gap closure and the audit/loop-closure
narrative will. Native mobile and custodian API are longer-horizon; the PWA is competitive with
HSA Vault's distribution model for now.

**Biggest threats to watch:** **Reimbursable** adding deposit matching (would erase the
loop-closure edge) and **HSA Store/Health-E Commerce** leveraging free + retail distribution to
own the top of the funnel. Reclaim's defensibility narrative is the durable answer to both.

---

_Methodology: live web research on 2026-06-16 via official sites, app-store listings, a press
release, and third-party reviews; every external claim is linked inline, and unverifiable items
are marked "Not found." Reclaim's profile is grounded in this repository's source code, with
code-proven facts separated from inferences. Findings are point-in-time and will drift._

---

## Candid Assessment (2026-06-17)

_Requested as an unbiased go/no-go — no encouragement, no inflation. Fresh review research
this date; sources cited inline. **Fact vs inference is flagged, and where confidence is low
I say so.** Note up front: the traction reads below rest on **weak signals** (tiny app-store
rating counts, Reddit blocked to the research crawler, no findable third-party reviews for
Reimbursable/Shoebox). Treat the "category is pre-traction" claim as **medium-confidence
inference**, not established fact — real demand could exist but be served privately
(spreadsheets, custodian tools)._

### 1. The verdict

**Bottom line: Long-shot** as a standalone D2C paid app at the intended $120–240/yr. It rises
to **Plausible only if you pivot the wedge to audit-defensibility _and_ secure non-paid
distribution (custodian/employer channel).** It is not "Strong," and I won't pretend it is.

Why long-shot, plainly:

- **The niche is real but unproven, and saturated with free/cheap substitutes.** The direct
  field is a graveyard of low-traction apps: HSA Store's ExpenseTracker — backed by a large
  retailer (Health-E Commerce) — has just **3.5★ on 11 ratings**
  ([App Store](https://apps.apple.com/us/app/expensetracker-by-hsa-store/id6528121942)); HSA
  Tracker Pro markets "4.9★, 2,000+ users" but the App Store shows **5.0 from 1 rating**
  ([App Store](https://apps.apple.com/us/app/hsa-tracker-pro/id6759116912)); Reimbursable and
  Shoebox have **no findable third-party reviews at all** (_Not found_). _(Inference,
  medium confidence:)_ when this many funded-enough players have launched and **none** has
  visible traction, the usual cause is **thin willingness-to-pay**, not an open goal. The job
  is real but **low-frequency and deferred-payoff**, and it is adequately served by free
  options: spreadsheets, Notion templates, and free custodian apps. White Coat Investor — an
  authoritative personal-finance voice — recommends **provider tools or a spreadsheet**, not a
  dedicated app ([WCI](https://www.whitecoatinvestor.com/the-best-way-to-track-your-hsa-receipts/)).
- **Our genuinely unique features (Substantiation Record + closed-loop deposit match) are not
  yet proven to be things people will pay for** — they're things _we_ believe matter. That's a
  hypothesis, not traction.

**What's actually left for us** (incumbents/Shoebox do _not_ cover this today): the
**defensibility + closed-loop** pairing. Shoebox is capture-and-store; Reimbursable is
detect-and-fill-Form-8889; HSA Store is retail lead-gen. None builds an audit-survival record
_and_ confirms the money arrived. That gap is real — but narrow.

**Conditions that must be true to win, and my honest read:**

1. **Capture must be genuinely frictionless** (≤30 sec or users skip it — the shoebox-strategy
   guides are explicit ([HSA Trackr](https://www.hsatrackr.com/guides/hsa-shoebox-strategy)))
   **and beat a spreadsheet.** _Achievable_ — it's an execution problem, and our OCR + Plaid
   stack is a head start.
2. **Distribution must not be paid-D2C.** _Doubtful._ A $120/yr niche app cannot sustain paid
   acquisition (see §5). This requires a custodian/employer partnership you do not have.
3. **Real WTP for "audit defensibility"** above the $0–$36/yr substitutes. _Doubtful and
   unproven_ — this is the crux, and nothing in the evidence confirms it yet.

Conditions #2 and #3 are the ones likely to sink it. #1 you can build.

### 2. Honest moat check

**There is no durable product moat today. Everything we have is a head start, not a wedge.**

| "Moat"                            | Reality                                                                                                                                                                     | Time to copy |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Substantiation Record             | A templated PDF/CSV with timestamps + IRS citations. The _logic_ (confirm → snapshot → cite §213(d)/Pub 969) is fully described in our own docs and trivially reproducible. | ~a quarter   |
| Closed-loop deposit match         | Plaid + amount-matching (±$0.01, 90-day window). **Reimbursable already runs on Plaid** — this is the single most copyable "unique" feature we have.                        | ~a quarter   |
| Pub 502 AI classifier (~80 rules) | Public IRS data + a Gemini prompt. No proprietary data, no network effect.                                                                                                  | weeks        |

The only **candidate** real moats, neither of which we hold:

- **Accumulated-receipt switching cost.** Years of a user's receipts in one place is genuine
  lock-in — but it requires (a) winning the user _first_ and (b) the user trusting a startup to
  survive the **decades-long** shoebox horizon. That trust gap is exactly what pushes people to
  spreadsheets, so this moat works _against_ us until we're proven durable.
- **Distribution lock** via a custodian/benefits partnership (the Reclaim Health model — they
  have WEX/Securian/Empyrean ([reclaimhealth.com](https://www.reclaimhealth.com/))). This is a
  real, defensible moat — and the most realistic one for us — but it's a BD achievement, not a
  code achievement.

So: a well-resourced incumbent (or Shoebox) could replicate our best feature **in a quarter.**
Say it plainly — nothing technical stops them.

### 3. Features — Add / Cut / Double-down

**DOUBLE-DOWN (the only two things that can become a wedge):**

- **Audit-defensibility as the brand + the closed-loop deposit match.** Not because they're
  uncopyable, but because owning the _position_ first (and the receipts that accrue) is the only
  path to the two candidate moats above. This is shipped — make it the entire identity.
- **OCR that actually works on medical/doctor receipts.** This is the #1 incumbent complaint
  (HSA Store's scanner "failed 100% of the times I tried it,"
  [App Store](https://apps.apple.com/us/app/expensetracker-by-hsa-store/id6528121942)). If our
  Vertex OCR genuinely parses messy doctor/EOB receipts, that's a demonstrable, defensible-
  enough edge. **Verify this is true before marketing it.**

**ADD (tied to specific competitor gaps):**

- **Frictionless capture parity:** email/SMS-forward and retailer/Amazon capture. Shoebox
  already ships email-forward + an Amazon-scanning Chrome extension
  ([shoebox.io](https://www.shoebox.io/)); we have neither. Closes the most visible bake-off gap.
- **"Outlast-the-startup" trust:** one-click full export + auto-backup to the user's _own_
  Google Drive/Dropbox + an open data format. This directly answers the longevity fear that
  sends people to spreadsheets — and turns "what if you shut down?" from an objection into a
  selling point.
- **Productized assisted submission** to counter Reimbursable's human "Full Service" $29/mo tier
  ([reimbursable.com](https://reimbursable.com/hsa-reimbursement-tracker)) — the one place a
  rival out-features us.

**CUT (focus drains that won't earn a switch):**

- **Wellbie chat** (built but flag-gated) — a distraction; conversational AI won't move this
  market. Keep it dark.
- **Hospital-pricing transparency** (`fetch-hospital-pricing`, no UI) — off-thesis; kill or shelve.
- **Analytics/benchmarking/HSA-investment-tracker sprawl** in `Reports.tsx` — feature-bloat that
  doesn't drive a switch; trim to the one number that matters ("available to reclaim").
- **Collections/care-events** — nice organizational layer, not a reason to choose us.
- **Provider directory / bill dispute** — already archived; keep them dead.

If everything is a priority, nothing is: **two double-downs, three adds, the rest cut.**

### 4. Exploit the reviews (pattern → move)

Competitor pain points found this date, with how widespread each appears and our counter:

| Competitor pain point                                                                                                                                                                                                                       | Breadth / confidence                                                                                                       | Our move                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Medical-receipt OCR broken** — "the AI… failed 100% of the times I tried it"; "only seems to be able to find expenses… purchased online" (HSA Store, [App Store](https://apps.apple.com/us/app/expensetracker-by-hsa-store/id6528121942)) | Single detailed review but matches the app's whole design (retail-purchase-centric); **medium confidence it's structural** | Lead with **reliable doctor/EOB/cash-receipt OCR** — the use case incumbents fumble. Make the demo a crumpled doctor's-office receipt. |
| **Crash-on-setup** bugs (HSA Store, Google Play reports)                                                                                                                                                                                    | Low n; **low confidence** on prevalence                                                                                    | Table-stakes reliability; cheap to beat.                                                                                               |
| **Inflated traction claims** ("2,000+ users" vs 1 rating, HSA Tracker Pro)                                                                                                                                                                  | Verified discrepancy; **high confidence**                                                                                  | Don't compete on vanity metrics; the field is wide open on _real_ trust.                                                               |
| **LMN denials / repeated revisions / missed deadlines** (Truemed, [Trustpilot/search](https://www.trustpilot.com/review/truemed.com))                                                                                                       | Recurring theme; **medium confidence**                                                                                     | Position the Substantiation Record as **"the record custodians actually accept"** — get the documentation right the first time.        |
| **Friction kills logging** — "if logging a receipt takes more than 30 seconds, you'll skip it" ([HSA Trackr](https://www.hsatrackr.com/guides/hsa-shoebox-strategy))                                                                        | Stated as the category truth; **high confidence**                                                                          | One-tap capture; auto-capture via Plaid; never make the user type.                                                                     |
| **Distrust of apps for a decades-long strategy → spreadsheets preferred** ([WCI](https://www.whitecoatinvestor.com/the-best-way-to-track-your-hsa-receipts/))                                                                               | Authoritative source + recurring ethos; **medium-high confidence**                                                         | Portable export + self-owned backup (see §3) so choosing us isn't a decades-long bet on our survival.                                  |

The honest pattern: incumbents are **buggy, retail-skewed, and low-trust** — beatable on
execution — but their reviews also reveal **how few people are using any of this**, which is
the demand worry, not a comfort.

### 5. Go-to-market & scale

- **Wedge segment to win first:** high-balance, retirement-minded HSA maximizers (the FIRE /
  Bogleheads / r/HSA "shoebox strategy" crowd). They have the most receipts, the most audit
  anxiety, and the highest WTP. Narrow, but identifiable and concentrated.
- **Channels that fit a D2C HSA app:** content/SEO (but **Reimbursable already owns much of this
  surface** with its eligible-items directory + "best apps" blog — hard to dislodge); PF
  influencers (WCI, Bogleheads, FIRE YouTubers) for credibility; and the **real unlock —
  B2B2C via HSA custodians/benefits platforms** (Lively, Fidelity, Optum; or the Reclaim Health
  partnership model). Custodian distribution is also where the durable moat lives.
- **CAC / retention dynamics (inference, medium confidence):** engagement is **low-frequency**
  (users touch it a few times a year), which means **high churn risk** on a subscription and
  weak organic/word-of-mouth loops. At ~$120/yr LTV, **paid D2C CAC very likely exceeds LTV** —
  paid acquisition won't pencil. Annual billing and accumulated-receipt lock-in are the only
  things that make retention work, and lock-in only kicks in _after_ you've won the user.
- **The moment you're defensible:** when you're a **custodian-endorsed default** or you hold
  **years of a user's receipts**. Both are far off and sequential (you need traction first).
- **Realistic resourcing/time:** ~**12–18 months** and at least one distribution partnership to
  validate the thesis. A pure-D2C path risks spending that year proving WTP is too low.
- **Hardest single obstacle:** **distribution + willingness-to-pay against free incumbents** —
  concretely, **CAC exceeding LTV** for a low-frequency, deferred-value product. Everything else
  is solvable; this is the one that kills it.

### 6. Kill criteria (walk-away / pivot signals)

Pursue something else — or pivot hard — if you see:

- **Free→paid conversion < ~2–3%** after a real cohort, or **trial→paid** materially below the
  consumer-SaaS norm.
- **6-month paid retention < ~40%**, or engagement decaying to near-zero between tax seasons.
- **Qualitative churn reason clusters on "I'd just use a spreadsheet / my custodian's tool"** —
  the signal that the unique features don't justify the price.
- **No custodian/employer partnership LOI within ~6–9 months** of seriously pursuing B2B2C — i.e.
  the one viable distribution path isn't opening.
- **A funded competitor ships your wedge first:** Reimbursable adds deposit-matching, or HSA
  Store fixes its OCR and adds Plaid — before you have defensible traction.
- **CAC stays above ~⅓ of LTV** with no credible path down after testing the main channels.

Any two of these together is a pivot signal; the partnership failure (#4) plus CAC>LTV (#6) is a
walk signal.

### Straight talk

If it were my money and my year: **I would not build it as-is, and I would not walk — I would
pivot.** The standalone-D2C-paid-app framing is the part that's a long-shot: the category is
unproven, the substitutes are free, the features are copyable in a quarter, and the unit
economics of paid acquisition at $120/yr don't work. But the underlying assets are genuinely
good and the one truly defensible path is real: **audit-defensibility + closed-loop, distributed
through an HSA custodian or employer-benefits channel rather than sold one user at a time.** The
single most important thing to change is **not a feature — it's to prove distribution and
willingness-to-pay before building anything else.** Get one custodian/benefits partner to pilot
the substantiation engine to their existing HSA base; if that opens, you have a business and a
moat; if it doesn't open in two or three quarters, the kill criteria above are telling you the
truth and you should redeploy the year elsewhere.

_All competitor facts above are point-in-time (2026-06-17), drawn from app-store listings and
third-party sources cited inline; "Not found" means unverifiable, not zero. Traction/WTP
conclusions are explicitly labeled inference and are medium-confidence given thin public data._
