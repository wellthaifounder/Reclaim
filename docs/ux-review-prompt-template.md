# UX Review — runnable prompt template

A portable version of the prompt that produced the Wellth.ai review at
[ux-review-2026-05.md](./ux-review-2026-05.md). Copy this file to any
React + agentic-coding-assistant repo, fill in the eight `{{PLACEHOLDERS}}`
in the briefing section, and you have a runnable deep-UX review for any
app. The methodology (hats, steel-man rule, output format, verification
checklist) is intentionally domain-agnostic.

## Step 1 — Fill these in

Answer these eight questions and the rest of the prompt works mechanically:

1. **`{{APP_NAME}}`** — e.g. "Acme Financial Simulator".
2. **`{{APP_PITCH}}`** — one sentence. e.g. "An interactive Monte-Carlo
   retirement-planning simulator for couples."
3. **`{{REGULATORY_PROFILE}}`** — e.g. "no PHI, no PCI; light SEC-adviser
   adjacency since users see projection numbers." Use "none" if it's a
   pure consumer app.
4. **`{{TECH_STACK}}`** — e.g. "Next.js 15 + tRPC + Postgres" or "React 18
   - Vite + Supabase".
5. **`{{CODEBASE_LANDMARKS}}`** — 5–8 file paths grouped by concern (see
   shape below).
6. **`{{PRIMARY_PERSONA}}`**, **`{{ADVERSARIAL_PERSONA_1}}`**,
   **`{{ADVERSARIAL_PERSONA_2}}`** — see the persona guide below.
7. **`{{TIME_TO_VALUE_DEFINITION}}`** — what's the user's first "ah-ha"
   moment? e.g. "first chart of their own projected outcomes" not "land
   on the dashboard."
8. **`{{PRIMARY_WORKFLOWS}}`** — 4–6 user flows that span your app's
   value-prop. Verbs, not nouns. e.g. "create a plan / model a scenario
   / compare two scenarios / share with advisor / export PDF."

### Persona guide

Each persona is a 2–4 sentence character with: who they are, what they
just did to land on your app, what they will _resent_ you for, what
their abandonment trigger is.

- **Primary lens** — the user whose first 3 minutes you're optimizing
  for. Usually anxious / new / under-resourced. Their abandonment trigger
  defines the time-to-value bar.
- **Adversarial #1 — power user.** Already knows the domain. Will
  resent hand-holding, modal carousels, "Get started!" copy. Use them
  to stress-test whether your time-to-value optimizations introduce
  friction for fluent users.
- **Adversarial #2 — bulk / edge case.** Has scale or complexity the
  single-user model handwaves: a couple, a family, a portfolio of LLCs,
  bulk import, etc. Use them to surface workflow edges.

### Codebase landmarks shape

Group 5–8 files like this. Generic categories that fit most apps:

```
- Onboarding & first-run: <auth/landing/welcome files>
- Primary workflows: <wizard/form/upload files>
- IA & layout: <App.tsx, sidebar, top nav, bottom tab>
- Settings / account: <where the user manages their state>
- Feature flags: <if you have them>
- Telemetry / analytics: <where events get fired>
```

---

## Step 2 — The prompt itself

Everything below is what the agent reads. Paste this whole document
into your repo at `docs/ux-review-prompt.md` (after filling in Step 1)
and invoke with:

> Read [docs/ux-review-prompt.md](./ux-review-prompt.md) and execute it
> end-to-end. The output goes to `docs/ux-review-YYYY-MM.md` where YYYY-MM
> is the current month. Do not skip the hands-on Playwright protocol or
> the steel-man rule. If something blocks you (env, migrations, etc.),
> fix it as you go and document the fixes in the report's "How this
> review was conducted" section — don't degrade the review to code-only.

---

## Briefing

You are reviewing **`{{APP_NAME}}`** — `{{APP_PITCH}}`.
Regulatory / trust profile: `{{REGULATORY_PROFILE}}`.
Tech: `{{TECH_STACK}}`. The full codebase guide is in
[CLAUDE.md](../CLAUDE.md) (or `README.md` if no CLAUDE.md exists).

**Read the previous review first**: the most recent
`docs/ux-review-*.md` (if any) tells you what's already been addressed.
Don't repeat findings the team has already shipped against unless they
regressed; do call out things that _were_ shipped if they're now hurting.

**Codebase landmarks** (read these before forming opinions; structure
may have evolved):

```
{{CODEBASE_LANDMARKS}}
```

## Personas (use all three; primary is the first one)

- **Primary lens — `{{PRIMARY_PERSONA}}`.**
  _(Time-to-value bar: this user needs to feel something useful happening
  within `{{TIME_TO_VALUE_DEFINITION}}` or they close the tab.)_
- **Adversarial hat 1 — `{{ADVERSARIAL_PERSONA_1}}`.**
  Use them to stress-test whether time-to-value optimizations introduce
  friction for power users.
- **Adversarial hat 2 — `{{ADVERSARIAL_PERSONA_2}}`.**
  Use them to surface bulk/edge cases the single-user model handwaves.

## Hats — wear all of these explicitly, label each one

Apply each hat at least once across the review. **Don't blend them
silently** — when you put one on, name it and reason from inside it.

1. **De Bono — Black hat (risk/critique)**: where will users fail, get
   hurt, or lose trust? What breaks under network failure, validation
   error, third-party-service disconnect, mid-flow abandonment?
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
8. **Hostile competitor PM**: imagine you work at a direct competitor and
   you've just been handed `{{APP_NAME}}`'s URL. What's your honest
   internal Slack reaction? What would you copy, what would you mock?
9. **Adult-child-setting-it-up-for-a-parent**: a stress test for clarity.
   If a 35-year-old has to set this up for their 68-year-old parent over
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
   ("The power user would resent this" counts.)
3. **Where does the complexity go?** Conservation of complexity:
   simplification here usually means complexity moves — to onboarding,
   to settings, to support, to engineering. Name where.
4. **Smallest reversible test** — the cheapest experiment that would
   invalidate your recommendation before a full redesign. (A copy
   change, a feature flag for 5 % of users, a hallway test, etc.)

A recommendation without all four is a _draft_, not a finding. Mark it
as such.

## Review areas

### Area 1 — Time-to-value

Run the dev server and create a fresh account. Time the journey from
`/` or `/auth` (or your equivalent) → first moment of perceived value,
with a stopwatch. The bar is set by the primary persona — see the
briefing.

Report:

- The exact path the primary persona takes (screens, decisions, fields).
- Decision count and reading load.
- Where the time-to-value clock breaks and why.
- The earliest possible "ah-ha" moment in the current design vs. what's
  theoretically achievable.
- Inventory every onboarding surface that fires in the first 60 seconds
  (modals, banners, ribbons, empty-state cards, carousels). Identify
  conflicts.
- Whether any pre-signup hand-off (calculator output, intake quiz, demo
  scenario) survives into the post-signup state meaningfully.

### Area 2 — Workflow coherence (right path? multiple paths? edge cases?)

For each of these primary workflows — **`{{PRIMARY_WORKFLOWS}}`** —
produce:

- The intended happy path.
- _Every_ entry point that exists today (expect duplication).
- Edge cases tested live: network drops mid-flow, third-party service
  times out, user abandons at step 3 of wizard, user submits invalid
  data, user submits with required field missing, duplicate
  submissions, > 10 items batch, very large payload.
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
- **Dashboard widget stack** — which widgets earn their pixels for the
  primary persona? For the power user? Should the dashboard be
  persona-shaped?
- **Top-level navigation** — sidebar groups + bottom-tab items + any
  floating actions. What's the smallest IA that still serves all the
  primary workflows?
- **Conditional nav state** — does the navigation shape-shift based on
  feature flags, subscription tier, or user state? Coherent or jarring?
- **Wizards vs modals vs pages** — pattern or accident?
- **Component duplication candidates** — flag any two components that
  do near-identical work.

For each "cut/merge/redesign" candidate, the steel-man rule applies in
full.

### Area 4 — What the founder didn't ask about (your "what's missing" list)

Cover these dimensions at minimum, plus anything else you find:

- **Trust & legitimacy signals** — calibrated to your regulatory
  profile. In-product privacy/encryption cues, error transparency,
  source-of-truth disclosures (where do these numbers come from?
  what's the data freshness?).
- **Vocabulary / mental-model alignment** — internal jargon leaking
  out?
- **Activation moment** — what's the _single concrete event_ after which
  a user is materially likelier to retain? Does the app drive toward it?
- **Retention loops** — what brings the user back in week 2?
- **Subscription / upgrade gating placement** — where do upgrade
  prompts appear? Before or after value?
- **Failure modes & recovery** — half-finished form, third-party
  disconnect, stalled fetches, validation errors that lose user input.
- **Mobile vs desktop parity** — is one platform clearly the "real"
  experience?
- **Cognitive load budget** — count required decisions in the first
  session.
- **Discoverability of secondary features** — list every feature that
  isn't on the primary path. How does the primary persona find them?
  When?
- **Accessibility** — keyboard nav through any wizards, focus traps in
  modals, alt text, color contrast, reduced-motion.
- **Performance perception** — skeleton loaders, optimistic UI,
  perceived latency, stalled-fetch fallbacks.
- **Copy quality** — tone calibrated to the primary persona's emotional
  state, jargon, microcopy on errors. Quote specific strings.
- **Telemetry gap** — note (don't fix) the funnel events that _would_
  answer "is this working?" and aren't obviously instrumented.
- **Onboarding for devs** — `npm install && <bootstrap-command>` from a
  fresh clone should succeed; if it doesn't, that's a finding (any
  contractor or CI box hits it day 1).

### Area 5 — Synthesis

Close the report with:

1. **Top 5 highest-leverage findings**, ranked by (impact × likelihood)
   ÷ cost. Each must carry the full steel-man.
2. **Top 3 "draft" recommendations** — things you suspect but couldn't
   fully justify; honest about uncertainty.
3. **The single change that, if you could only do one, would do the
   most for the primary persona** — and the price the power user pays
   for it.
4. **Pre-mortem paragraph** — if these recommendations ship and fail in
   6 months, what's the most likely autopsy?

## Hands-on protocol (must do, not optional)

If the repo doesn't yet have a Playwright walkthrough, scaffold one at
`tests/ux-review/` with: `playwright.config.ts` (desktop + mobile
projects), `helpers.ts` (session-stub, screenshot helper, observation
appender), and `walkthrough.spec.ts` (the actual walkthrough).
A reference implementation lives in the original Wellth.ai
[tests/ux-review/](https://github.com/wellthaifounder/wellth-ai/tree/main/tests/ux-review).

1. Boot the dev server. Open the app in an incognito browser. Throttle
   network to "Fast 3G" for at least one pass — your primary persona is
   probably on a phone.
2. Sign up with a fresh email (or stub a session if no real backend is
   available). Walk through to the post-signup landing surface.
   Stopwatch on.
3. Repeat with any pre-signup hand-off (calculator, quiz, demo). Compare.
4. Try every primary workflow at least once on mobile viewport
   (DevTools device mode) and once on desktop.
5. Deliberately break things: cancel mid-wizard, submit invalid data,
   navigate away during a third-party redirect, try to perform an
   action with required state missing.
6. Look for routes the nav doesn't surface (e.g. hit retired-feature
   URLs directly).
7. Use any AI / chat / assistant feature once as the primary persona,
   once as the power user. Different prompts, different expectations.
8. **Drive the walkthrough via Playwright** so screenshots and
   observations land in `tests/ux-review/_artifacts/` (gitignored).

If the dev-bootstrap command fails on a fresh clone, fix the failure
and include the fix in the review (don't pivot to placeholder env
unless the fix would itself be more than ~2 hours of work; if you do
pivot, document it in the "How this review was conducted" section).

## Output format

A single markdown report at `docs/ux-review-YYYY-MM.md` (current
month) with this structure:

```
# {{APP_NAME}} UX Review — YYYY-MM

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
4. **"The power user didn't get sacrificed for the primary persona"** —
   power-user costs are visible, not hidden.
5. **"Time-to-value stopwatch is in the doc"** — actual times, not
   abstract assessment.
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

---

## Worked example: Wellth.ai (for shape reference)

The original Wellth.ai filled in Step 1 like this. Use it as a sanity
check that your answers are at the right grain.

1. **APP_NAME**: Wellth.ai
2. **APP_PITCH**: A HIPAA-relevant healthcare expense tracker — HSA/FSA,
   receipt OCR, Plaid bank linking, reimbursement workflows.
3. **REGULATORY_PROFILE**: HIPAA-relevant (PHI in receipts/invoices),
   PFI via Plaid encrypted access tokens.
4. **TECH_STACK**: React 18 + Vite + Supabase.
5. **CODEBASE_LANDMARKS**:
   ```
   - Onboarding & first-run: src/pages/Auth.tsx, src/pages/Dashboard.tsx,
     src/components/onboarding/, src/components/dashboard/EmptyStateOnboarding.tsx
   - Primary workflows: src/components/bills/BillUploadWizard.tsx,
     src/components/PlaidLink.tsx, src/components/hsa/HSAAccountManager.tsx,
     src/pages/HSAReimbursement.tsx
   - IA & layout: src/App.tsx, src/components/AppSidebar.tsx,
     src/components/BottomTabNavigation.tsx, src/components/AuthenticatedLayout.tsx
   - Settings: src/pages/Settings.tsx
   - Feature flags: src/lib/featureFlags.ts
   - Telemetry: src/lib/analytics.ts
   ```
6. **PRIMARY_PERSONA**: "Maya, anxious first-timer. Recently received a
   $4,200 ER bill, never used an HSA tool, signs up on her phone at
   11 pm. Low patience for jargon, high anxiety, will abandon at the
   first 'what does this mean?' moment."
   **ADVERSARIAL_1**: "Derek, HSA-savvy optimizer. Already maxes his HSA,
   three years of receipts in a Drive folder, wants reports and accuracy.
   Will resent hand-holding."
   **ADVERSARIAL_2**: "Priya, chronic-care caregiver. Bills for herself
   - an aging parent. Needs bulk uploads, family-grouping, recurring
     care events."
7. **TIME_TO_VALUE_DEFINITION**: 3 minutes from arriving on the landing
   page to seeing her own projected savings on the dashboard.
8. **PRIMARY_WORKFLOWS**: add HSA account / upload receipt / link Plaid
   bank / submit reimbursement / track a bill.

Compare your answers — if any of yours feel vaguer than these, sharpen
them before running.
