# Wellth.ai UX Review — runnable prompt

This is a self-contained prompt for an agentic coding assistant (Claude Code,
Cursor, Aider, etc.) to produce a deep UX review of Wellth.ai end-to-end.
The first run of this prompt produced [ux-review-2026-05.md](./ux-review-2026-05.md).
Re-run it whenever a meaningful chunk of the product has changed.

## How to invoke

Open the repo in your agent of choice and paste **exactly** this:

> Read [docs/ux-review-prompt.md](./ux-review-prompt.md) and execute it
> end-to-end. The output goes to `docs/ux-review-YYYY-MM.md` where YYYY-MM
> is the current month. Do not skip the hands-on Playwright protocol or the
> steel-man rule. If something blocks you (env, migrations, etc.), fix it
> as you go and document the fixes in the report's "How this review was
> conducted" section — don't degrade the review to code-only.

That single sentence is enough; everything below is the spec the agent reads.

---

## Briefing

You are reviewing **Wellth.ai**, a HIPAA-relevant healthcare expense
tracker (HSA/FSA, receipt OCR, Plaid bank linking, reimbursement
workflows). Tech: React 18 + Vite + Supabase. The full codebase guide is in
[CLAUDE.md](../CLAUDE.md).

**Read the previous review first**: [the most recent
`docs/ux-review-*.md`](.) tells you what's already been addressed and what
the prior cohort of recommendations focused on. Don't repeat findings the
team has already shipped against unless they regressed; do call out things
that _were_ shipped if they're now hurting.

**Codebase landmarks** (read these before forming opinions; structure may
have evolved):

- Onboarding & first-run: [src/pages/Auth.tsx](../src/pages/Auth.tsx),
  [src/pages/Dashboard.tsx](../src/pages/Dashboard.tsx),
  [src/components/onboarding/](../src/components/onboarding/),
  [src/components/dashboard/EmptyStateOnboarding.tsx](../src/components/dashboard/EmptyStateOnboarding.tsx)
- Workflows: [src/components/bills/BillUploadWizard.tsx](../src/components/bills/BillUploadWizard.tsx),
  [src/pages/NewBillUpload.tsx](../src/pages/NewBillUpload.tsx),
  [src/components/PlaidLink.tsx](../src/components/PlaidLink.tsx),
  [src/pages/BankAccounts.tsx](../src/pages/BankAccounts.tsx),
  [src/components/hsa/HSAAccountManager.tsx](../src/components/hsa/HSAAccountManager.tsx),
  [src/pages/HSAReimbursement.tsx](../src/pages/HSAReimbursement.tsx)
- IA & layout: [src/App.tsx](../src/App.tsx),
  [src/components/AppSidebar.tsx](../src/components/AppSidebar.tsx),
  [src/components/BottomTabNavigation.tsx](../src/components/BottomTabNavigation.tsx),
  [src/components/AuthenticatedLayout.tsx](../src/components/AuthenticatedLayout.tsx),
  [src/pages/Settings.tsx](../src/pages/Settings.tsx)
- Feature flags currently controlling UX experiments: [src/lib/featureFlags.ts](../src/lib/featureFlags.ts)
- Telemetry events the product instruments: [src/lib/analytics.ts](../src/lib/analytics.ts)

## Personas (use all three; primary is Maya)

- **Primary lens — "Maya," anxious first-timer.** Recently received a
  $4,200 ER bill, never used an HSA tool, signs up on her phone at 11 pm.
  Low patience for jargon, high anxiety, will abandon at the first
  "what does this mean?" moment. **Time-to-value bar: 3 minutes from
  arriving on the landing page to feeling something useful happening.**
- **Adversarial hat 1 — "Derek," HSA-savvy optimizer.** Already maxes his
  HSA, three years of receipts in a Drive folder, wants reports and
  accuracy. He will _resent_ hand-holding, modal carousels, and
  "let's get you started!" copy. Use him to stress-test whether
  time-to-value optimizations introduce friction for power users.
- **Adversarial hat 2 — "Priya," chronic-care caregiver.** Bills for
  herself + an aging parent. Needs bulk uploads, family-grouping,
  recurring care events. Use her to surface bulk/edge cases the
  single-user model handwaves.

## Hats — wear all of these explicitly, label each one

Apply each hat at least once across the review. **Don't blend them
silently** — when you put one on, name it and reason from inside it.

1. **De Bono — Black hat (risk/critique)**: where will users fail, get
   hurt, or lose trust? What breaks under network failure, OCR error,
   Plaid disconnect, mid-flow abandonment?
2. **De Bono — Yellow hat (value/optimism)**: what is genuinely working?
   Don't only critique. A review that finds nothing good has miscalibrated.
3. **De Bono — Green hat (creative)**: propose at least 3 alternative IAs
   / flows that aren't the current design or its mirror image.
4. **De Bono — Red hat (gut/emotion)**: how does the app _feel_ in the
   first 30 seconds? In minute 3? After failing once?
5. **Steve Krug ("Don't Make Me Think")**: count clicks, decisions, and
   reads-required for each primary task. Flag any moment where the user
   must consult their working memory to proceed.
6. **Don Norman (mental models / affordances)**: do labels match the
   user's vocabulary? Do controls afford their function? Are there false
   affordances (clickable-looking-but-not, or vice versa)?
7. **Marty Cagan PM lens**: for each major feature, name the value
   hypothesis and ask whether the current UX tests it. Features that
   don't earn their footprint are candidates for cutting.
8. **Hostile competitor PM**: imagine you work at Lively or HealthEquity
   and you've just been handed Wellth.ai's URL. What's your honest
   internal Slack reaction? What would you copy, what would you mock?
9. **Adult-child-setting-it-up-for-a-parent**: a stress test for clarity.
   If a 35-year-old has to set this up for their 68-year-old father over
   the phone, where does the call go off the rails?
10. **Pre-mortem hat**: imagine 6 months from now your recommendations
    shipped and the redesign _failed_. Write the failure post-mortem
    _before_ recommending. What was the most likely cause?

## Steel-man rule (mandatory for every recommendation)

No recommendation lands unless you've written all four:

1. **Best case for keeping the current design** — argue it as if you
   designed it on purpose. What were they likely optimizing for? Who
   benefits today?
2. **Who could the change hurt?** Name the persona/segment.
   ("Derek would resent this" counts.)
3. **Where does the complexity go?** Conservation of complexity:
   simplification here usually means complexity moves — to onboarding,
   to settings, to support, to engineering. Name where.
4. **Smallest reversible test** — the cheapest experiment that would
   invalidate your recommendation before a full redesign. (A copy
   change, a feature flag for 5 % of users, a hallway test, etc.)

A recommendation without all four is a _draft_, not a finding. Mark it
as such.

## Review areas

### Area 1 — Time-to-value < 3 minutes

Run the dev server and create a fresh account. Time the journey from `/`
or `/auth` → first moment of perceived value, with a stopwatch. Report:

- The exact path Maya takes (screens, decisions, fields).
- Decision count and reading load.
- Where the 3-minute clock breaks and why.
- The earliest possible "ah-ha" moment in the current design vs. what's
  theoretically achievable.
- Inventory every onboarding surface that fires in the first 60 seconds
  (modals, banners, ribbons, empty-state cards, carousels). Identify
  conflicts.
- Whether the calculator-pre-signup projection (if still wired up)
  survives into the dashboard meaningfully.

### Area 2 — Workflow coherence (right path? multiple paths? edge cases?)

For each of the five primary workflows — **add HSA account, upload
receipt, link Plaid, submit reimbursement, track a bill** — produce:

- The intended happy path.
- _Every_ entry point that exists today (expect duplication).
- Edge cases tested live: OCR fails, Plaid auth times out, network drops
  mid-upload, user abandons at step 3 of wizard, user uploads a
  non-medical bill, HSA submitted with no provider selected, receipt
  with no date, duplicate uploads, > 10 files, very large file.
- Where the user is forced to leave one section and navigate elsewhere
  mid-task (cross-flow friction).
- Vocabulary collision: do the URL, the sidebar label, the page heading,
  and the marketing-page card all agree on what to call things?
- Removed-feature URLs: what happens when the user types or follows a
  link to a path that was retired? Silent redirect or interstitial?

### Area 3 — UI simplification / condensation candidates

Inventory and grade for cutting:

- **Settings density** — count sections; measure scroll height.
  Tabbed/split alternatives.
- **Dashboard widget stack** — which widgets earn their pixels for
  Maya? For Derek? Should the dashboard be persona-shaped?
- **Top-level navigation** — sidebar groups + bottom-tab items + any
  floating actions. What's the smallest IA that still serves all five
  workflows?
- **Bottom-tab shape-shift** based on conditional state — coherent or
  jarring?
- **Wizards vs modals vs pages** — pattern or accident?
- **Component duplication candidates** — flag any two components that
  do near-identical work.

For each "cut/merge/redesign" candidate, the steel-man rule applies in
full.

### Area 4 — What the founder didn't ask about (your "what's missing" list)

Cover these dimensions at minimum, plus anything else you find:

- **Trust & legitimacy signals** — health + finance + AI = high trust
  burden. In-product privacy/encryption cues, error transparency.
- **Vocabulary / mental-model alignment** — internal jargon leaking
  out?
- **Activation moment** — what's the _single concrete event_ after which
  a user is materially likelier to retain? Does the app drive toward it?
- **Retention loops** — what brings the user back in week 2?
- **Subscription gating placement** — where do upgrade prompts appear?
  Before or after value?
- **Failure modes & recovery** — half-uploaded bill, Plaid disconnect,
  OCR-blank receipt, stalled fetches.
- **Mobile vs desktop parity** — is one platform clearly the "real"
  experience?
- **Cognitive load budget** — count required decisions in the first
  session.
- **Discoverability of secondary features** — Wellbie chat, Reports,
  HSA Calculator, HSA Guide.
- **Accessibility** — keyboard nav through the wizards, focus traps in
  modals, alt text, color contrast, reduced-motion.
- **Performance perception** — skeleton loaders, optimistic UI,
  perceived latency.
- **Copy quality** — anxious-user-friendly tone, jargon, microcopy on
  errors. Quote specific strings.
- **Telemetry gap** — note (don't fix) the funnel events that _would_
  answer "is this working?" and aren't obviously instrumented.
- **Onboarding for devs** — `npx supabase start` from a fresh clone
  should succeed; if it doesn't, that's a finding (any contractor or
  CI box hits it day 1).

### Area 5 — Synthesis

Close the report with:

1. **Top 5 highest-leverage findings**, ranked by (impact × likelihood)
   ÷ cost. Each must carry the full steel-man.
2. **Top 3 "draft" recommendations** — things you suspect but couldn't
   fully justify; honest about uncertainty.
3. **The single change that, if you could only do one, would do the
   most for Maya** — and the price Derek pays for it.
4. **Pre-mortem paragraph** — if these recommendations ship and fail in
   6 months, what's the most likely autopsy?

## Hands-on protocol (must do, not optional)

The repo already has a Playwright walkthrough at
[tests/ux-review/](../tests/ux-review/). Reuse it.

1. `npm run dev` and open the app in an incognito browser. Throttle
   network to "Fast 3G" for at least one pass — Maya is on her phone.
2. Sign up with a fresh email (or stub a session via the helpers in
   [tests/ux-review/helpers.ts](../tests/ux-review/helpers.ts) if no
   real backend is available). Walk through to the dashboard. Stopwatch on.
3. Repeat with calculator pre-fill. Compare.
4. Try every primary workflow at least once on mobile viewport
   (DevTools device mode) and once on desktop.
5. Deliberately break things: cancel mid-wizard, upload a non-image,
   submit a form with bad data, navigate away during Plaid Link, try to
   claim with no HSA account configured.
6. Look for routes the nav doesn't surface (e.g. hit retired-feature
   URLs directly).
7. Use the Wellbie chat once as Maya, once as Derek. Different prompts,
   different expectations.
8. **Drive the walkthrough via Playwright** so screenshots and
   observations land in
   [tests/ux-review/\_artifacts/](../tests/ux-review/_artifacts/) (which
   is gitignored). Run with:
   ```
   npx playwright test --config=tests/ux-review/playwright.config.ts --project=desktop
   npx playwright test --config=tests/ux-review/playwright.config.ts --project=mobile
   ```
   Extend the existing
   [walkthrough.spec.ts](../tests/ux-review/walkthrough.spec.ts) if a new
   surface needs coverage.

If `npx supabase start` fails on a fresh clone, fix the migrations and
include the fix in the review (don't pivot to placeholder env unless
the migration fix would itself be more than ~2 hours of work; if you do
pivot, document it).

## Output format

A single markdown report at `docs/ux-review-YYYY-MM.md` (current
month) with this structure:

```
# Wellth.ai UX Review — YYYY-MM

**Reviewer / date / scope / method / personas** (1 short paragraph)

## Executive summary
1-page top-of-funnel: top 5 findings, plus the one thing genuinely
working that you'd protect from any redesign.

## How this review was conducted
Methodology, what you could test live, what you code-traced, anything
that broke and how you fixed it.

## Personas

## Area 1 — Time-to-value
### Stopwatch run (raw timeline)
### Findings (each: Black / Yellow / Green hat tag, steel-man,
###   recommendation, smallest test)

## Area 2 — Workflow coherence
### Per-workflow: happy path, entry points, edge cases tested,
###   findings

## Area 3 — UI simplification candidates
### Per-candidate: current state, proposal, steel-man, who it
###   hurts, where complexity goes, smallest test

## Area 4 — What was missing from the brief
### One subsection per added dimension

## Area 5 — Synthesis
### Top 5 with full steel-man
### Top 3 drafts
### Single-change recommendation
### Pre-mortem

## Appendix — file paths and line references
```

**Length budget:** 3,000–5,000 words. If you're going longer, you're
explaining instead of recommending. If shorter, you skipped hats.

**Style:** quote specific copy. Reference specific files in the format
`[Component.tsx:42](../src/components/Component.tsx#L42)`. Screenshots
welcome but not required (text descriptions of what you saw are
sufficient).

## Verification — how the founder will know the review is good

1. **"Could a designer ticketize this on Monday"** — every finding has a
   clear surface, current state, proposed change, and a smallest reversible
   test.
2. **"Every recommendation has a steel-man"** — search the doc for
   "Best case for keeping" or equivalent and find one per finding.
3. **"I disagree with at least one finding"** — if the founder reads it
   and nods at every line, the review was too cautious.
4. **"Derek didn't get sacrificed for Maya"** — power-user costs are
   visible, not hidden.
5. **"3-minute stopwatch is in the doc"** — actual times, not abstract
   assessment.
6. The pre-mortem in Area 5 names a plausible failure path the founder
   hadn't considered.

## What this review deliberately doesn't do

- **No code changes.** The deliverable is a markdown report.
  Implementation tickets follow approval — by convention they go in a
  separate `Phase 2` plan file or PR series.
- **No competitor deep-dive.** Competitors mentioned only where they
  materially solve a problem better.
- **No telemetry instrumentation.** Flag the gap; instrumenting it is a
  separate task.
- **No live user testing.** Heuristic + hands-on by the agent only.
  Hallway tests with real users are a follow-on if the founder wants
  them.
