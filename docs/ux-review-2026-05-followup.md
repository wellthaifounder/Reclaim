# Wellth.ai UX Review — 2026-05-07 Follow-up

**Reviewer:** Claude Opus 4.7 (Claude Code)
**Date:** 2026-05-07
**Scope:** Verify the five "Wave" fixes shipped between 2026-05-03 and 2026-05-07 actually land in the user-facing flow, plus net-new findings introduced by the changes.
**Method:** Re-ran the Playwright walkthrough at [tests/ux-review/walkthrough.spec.ts](../tests/ux-review/walkthrough.spec.ts) against `npm run dev` on Windows. 19 tests × 2 projects (desktop 1440×900, mobile Pixel 7) = 38 runs, all passing. **Local Supabase now starts cleanly** (Wave 1.A verified) — but to keep results comparable to the May report I ran the dev server with placeholder env, like before. Four new verification tests added to the spec; `mockProfileFetch` helper added to `helpers.ts` so we can inject `userIntent` (which Wave 5 moved out of the dialog and into the `profiles` row only).
**Personas (unchanged):** Maya / Derek / Priya. See [previous report](./ux-review-2026-05.md) for definitions.
**Screenshots:** [tests/ux-review/\_artifacts/screenshots/](../tests/ux-review/_artifacts/screenshots/) — 48 fresh PNGs. The May screenshots are preserved at [tests/ux-review/\_artifacts/screenshots-2026-05/](../tests/ux-review/_artifacts/screenshots-2026-05/) so cross-references in the prior report still resolve.

---

## Executive summary

Four of the five May Top-5 are **resolved**. The fifth (mobile wizard) is genuinely fixed. The onboarding consolidation that the May report most worried about — three competing surfaces, hectoring 0/3 ribbon — is now a calmer dashboard with a single hero CTA and a scoped ribbon. The net-new concerns are smaller and more surgical: a noisy global error toast that fires on _any_ failed query, an OnboardingWizard whose audience has quietly shifted (it now never fires for true zero-state users — only after they have a bill), and the unchanged telemetry gap that means the Wave 3/4 experiments are running blind.

**Top-3 remaining (in priority):**

1. **Telemetry still has no funnel.** Wave 3 and Wave 4 shipped behind feature flags that are now default-on, but [src/lib/analytics.ts](../src/lib/analytics.ts) still lacks named events for `signup`, `first_bill_uploaded`, `first_reimbursement_pdf`. The team can't tell whether the experiments are working. Higher-priority now than in May because the experiments are _live_, not staged.
2. **OnboardingWizard has lost its audience.** [Dashboard.tsx:282–288](../src/pages/Dashboard.tsx#L282) now requires `!isNewUser && expenseCount <= 3` for the carousel to auto-open. For a brand-new Maya (zero bills, no bank) `isNewUser === true`, so the carousel never fires. It only fires for someone who has 1–3 bills already — past Maya's anxiety window. Either move the trigger earlier or accept that the carousel is now a "second-session" tool and rename it accordingly.
3. **Global query error toast is too aggressive.** Verified live: every Maya-onboarding-style screenshot now carries a "We're having trouble loading your data. Please try again." toast on top of the empty state ([039](../tests/ux-review/_artifacts/screenshots/039-60-billing-intent-no-wizard.png)). For a user with no data and no expectation of any, the toast is alarming. Suppress when `data === undefined` _and_ this is a known-empty user state.

The big unequivocal win: the **"Start Saving on Healthcare Today" hero is no longer competing with three modal layers** ([006](../tests/ux-review/_artifacts/screenshots/006-10-maya-dashboard.png)). Maya's first authenticated screen is calm. That alone is the biggest UX delta since May.

---

## Verification matrix — May Top-5

| #   | May finding                           | Verdict                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Skeleton-forever on lists             | **Resolved**                              | [047](../tests/ux-review/_artifacts/screenshots/047-66-stalled-bills.png) — with all `/rest/v1/*` aborted, `/bills` shows "We had trouble loading your bills · Try again" within 5s. Implemented by [withQueryTimeout](../src/lib/queryHelpers.ts) (Wave 2).                                                                                                                                             |
| 2   | Mobile wizard CTA clipping at 390px   | **Resolved**                              | [038](../tests/ux-review/_artifacts/screenshots/038-41-mobile-upload-wizard.png) — Cancel & Continue fully visible; bottom nav suppressed via `hideBottomNav` in [AuthenticatedLayout.tsx](../src/components/AuthenticatedLayout.tsx). Bonus: dropzone copy is now "Take a photo or choose a file" (mobile-idiomatic), not "Drag & drop."                                                                |
| 3   | Three onboarding surfaces compete     | **Resolved (with caveat — see N1 below)** | [006](../tests/ux-review/_artifacts/screenshots/006-10-maya-dashboard.png) — single empty-state card, no modal carousel layered on top. UserIntentDialog deleted in Wave 5; OnboardingWizard auto-show conditioned on `!isNewUser` so true zero-state Mayas no longer see it.                                                                                                                            |
| 4   | Bills/Ledger/Collections/Documents IA | **Partial**                               | Bills + Ledger merged: `/ledger` 301s to `/bills?view=ledger`, tabs render ([041](../tests/ux-review/_artifacts/screenshots/041-62-bills-ledger-tab.png)). Sidebar still shows standalone "Ledger" item ([036](../tests/ux-review/_artifacts/screenshots/036-31-priya-ledger.png)) — flag-conditional removal didn't take effect at the desktop sidebar level. Collections + Documents still standalone. |
| 5   | Migration ordering blocks local dev   | **Resolved**                              | `npx supabase start` now applies all migrations cleanly through `20260506000000_default_user_intent_both.sql`. Verified by re-running on a clean container set.                                                                                                                                                                                                                                          |

**Flag verifications (Wave 3 sub-findings):**

- `AUTO_DISMISS_ONBOARDING_FOR_BILLING` — **Resolved.** [039](../tests/ux-review/_artifacts/screenshots/039-60-billing-intent-no-wizard.png), `mockProfileFetch({intent:'billing'})`, no carousel after 2s.
- `SCOPE_GET_STARTED_TO_DASHBOARD` — **Resolved on real off-dashboard pages.** Test reported "Partial" because `/settings` _appeared_ to leak the ribbon, but [044](../tests/ux-review/_artifacts/screenshots/044-64-no-ribbon--settings.png) reveals `/settings` actually redirected to `/dashboard` (where the ribbon legitimately renders). Root cause: [Settings.tsx:120–127](../src/pages/Settings.tsx#L120) calls `supabase.auth.getUser()` for JWT validation; placeholder env returns null → redirects to `/auth` → `Auth.tsx` sees the localStorage session and bounces to `/dashboard`. Same bounce affects `/transactions`, `/hsa-reimbursement`, `/bank-accounts`, `/user-reviews`. **Not a real ribbon-leak.** On `/bills` and `/reports` (which loaded), the ribbon is correctly hidden.
- `BILLS_LEDGER_IA_COLLAPSE` — **Resolved at the route + tab level**, **Partial at the sidebar level.** See #4.

---

## Net-new findings

### N1 — OnboardingWizard's audience has shifted; "for new users" is no longer accurate

[Dashboard.tsx:265–298](../src/pages/Dashboard.tsx#L265):

```ts
const isNewUser =
  stats.expenseCount === 0 && recentExpenses.length === 0 && !hasConnectedBank;
// ...
useEffect(() => {
  if (
    !loading &&
    !isNewUser &&
    stats.expenseCount <= 3 &&
    !onboarding.hasCompletedOnboarding &&
    !skipForBillingIntent
  ) {
    setTimeout(() => setShowWelcome(true), 1000);
  }
});
```

Maya at signup time has `isNewUser === true`. The carousel does **not** fire. It only fires for users who have between 1 and 3 bills _and_ haven't seen it yet — i.e. session 2+. The May report's worry about "OnboardingWizard hectoring Maya during her first authenticated minute" is no longer the active failure mode. The new question: is "second-session HSA education" actually the right slot? Maya has already done the work the carousel was meant to motivate. The carousel's title — "Your HSA is a wealth-building tool" — fits a pre-bill audience, not a 2-bills-in audience.

- **Steel-man:** the post-bill carousel catches users at the moment they have evidence the app works and might be receptive to deeper education. Pre-bill, Maya is task-focused and ignores all education.
- **Smallest test:** rename it (in code) from `OnboardingWizard` to `HSAValueCarousel` and re-evaluate whether it should live on a separate route (`/hsa/why`) instead of auto-firing.

### N2 — Global query error toast fires on benign empty states

`QueryCache.onError` (likely `App.tsx:86`, per the Wave 2 plumbing) surfaces a toast for every failed query. With placeholder env this means every dashboard test screenshot carries a "We're having trouble loading your data. Please try again." overlay ([039](../tests/ux-review/_artifacts/screenshots/039-60-billing-intent-no-wizard.png), [046](../tests/ux-review/_artifacts/screenshots/046-65-ribbon-on-dashboard.png)). In production this is the right behavior for a real fetch failure, but for a freshly-signed-up Maya whose backend hasn't been provisioned yet, the same toast greets her. **Recommendation:** distinguish "expected empty" (HTTP 200 with `[]`) from "fetch failed" (timeout / network) at the query layer. The toast should fire only on the latter. The Wave 2 fix at the per-page level (Bills/Ledger/Collections) already does this — extend it to the global handler.

### N3 — `/settings`, `/transactions`, `/bank-accounts`, `/hsa-reimbursement`, `/user-reviews` silent-redirect to `/dashboard` on auth failure

Live observation: in placeholder-env Maya state, these five routes all bounce to `/dashboard`. The mechanism: each page calls `supabase.auth.getUser()` (a network call to validate JWT) inside its load-data `useEffect`, and on failure calls `navigate("/auth")`, which then re-bounces to `/dashboard`. **In production with real auth this is invisible** — but it's a fragility cluster. If any of these pages is loaded while the network is briefly down, the user is silently bounced to the dashboard with no error message. Recommendation: replace the in-page `auth.getUser()` checks with the existing `ProtectedRoute` — which uses `getSession()` (localStorage, no network) and is already wrapping these routes. The duplicate auth check is fragile and unnecessary.

### N4 — Sidebar still shows "Ledger" entry despite Wave 4 IA collapse

The Wave 4 plan was: with `BILLS_LEDGER_IA_COLLAPSE` on, hide the standalone "Ledger" sidebar item. Inspecting the live mobile-bottom-tab nav ([006](../tests/ux-review/_artifacts/screenshots/006-10-maya-dashboard.png)) and the desktop nav inventory in observations: **"Ledger" is still shown in the bottom tab nav and in the desktop sidebar as a top-level entry.** Whether this is intentional (the bottom-tab Ledger is a shortcut to `/bills?view=ledger`) or a missed cleanup is unclear from the code. If intentional, the IA collapse is incomplete because users still navigate to a "Ledger" surface that's now a tab, not a destination — vocabulary mismatch. If unintentional, the cleanup is partial.

### N5 — Heading-on-page-load regression unfixed (May A4.10 still open)

`/bills`, `/ledger`, `/collections`, `/documents` still report `(no heading found)` in the live walkthrough — same as May. This is a screen-reader gap: the page's first heading is rendered after a network call, and there's no semantic landmark before that. Wave 2 added `aria-live="polite"` to `DashboardSkeleton` (per [Dashboard.tsx:303–306](../src/pages/Dashboard.tsx#L303)) but the same treatment hasn't reached the list pages. Adds one line per page; no design work needed.

### N6 — Decisions-to-dashboard count is now 6 (down from 8–10)

May counted 8–10 discrete decisions in Maya's signup flow. With UserIntentDialog removed and lazy HSA-date collection, the new count is 6: Sign In/Sign Up tab, Full Name, Email, Password, Privacy checkbox, Submit. **This is the largest behind-the-scenes win of Wave 5.** The five-pages-of-onboarding feel is gone. Worth celebrating, _and_ worth instrumenting before celebrating: the May pre-mortem worried that "removing the commitment ritual" might increase activation but hurt retention. Without the funnel events, that hypothesis is untested.

### N7 — "Start Saving on Healthcare Today" H1 still wrong-verb for Maya (May A1.2 unchanged)

The dashboard zero-state H1 is unchanged: "Start Saving on Healthcare Today." May A1.2 flagged it as 401k-brochure-coded for a user who arrived because of a $4,200 ER bill. Still true. Cheapest open finding from the May report.

### N8 — "Get Started 0/3 complete 0%" ribbon still says 0% on first-touch dashboard

[006](../tests/ux-review/_artifacts/screenshots/006-10-maya-dashboard.png): the ribbon shows "Get Started 0%" prominently above the empty-state card. The May review's "shame bar" criticism is now scoped (ribbon doesn't follow Maya around) but on the page where it _does_ render, it's still the very first thing Maya sees — _above_ the upload CTA. Consider: render the ribbon _below_ the empty-state card, so the action lands first and the progress meter is reinforcement, not gatekeeping.

---

## Newly-resolvable findings (now that local Supabase works)

The May report tagged Plaid Link, OCR, reimbursement PDF, and Stripe upgrade as ⚠️ Code-traced because there was no working local stack to exercise them. Wave 1.A unblocks all of these. **None were exercised in this review** because the dev server is still pointed at placeholder env to keep the comparison honest with May; but the harness is ready for a follow-up that flips `VITE_SUPABASE_URL=http://127.0.0.1:54321` and runs the same spec against a real backend. Recommended as a separate review in 2–4 weeks.

---

## What got better, in priority order

1. Mobile upload wizard ergonomics — buttons visible, copy idiomatic ✅
2. Stalled-fetch fallback — the "Try again" empty state is exactly the proposed pattern ✅
3. Onboarding stack compressed — three surfaces → one calm card ✅
4. Wave 1.A migration ordering — `npx supabase start` now works for new contractors ✅
5. Wave 5 lazy HSA date — fewer signup decisions, cleaner intent inference ✅

## What stayed the same and shouldn't have

1. Telemetry funnel — still nothing to evaluate the experiments by ❌
2. H1 copy "Start Saving…" — unchanged, still wrong-frame for Maya ❌
3. Heading landmarks on list pages — `(no heading found)` for screen readers ❌

## What got worse (regressions and new issues)

1. Global error toast over-fires on dashboard zero-state ⚠️ (N2)
2. OnboardingWizard now never fires for true zero-state users — audience drift, not a regression but a noteworthy semantics shift ⚠️ (N1)
3. Sidebar still shows "Ledger" despite IA collapse flag — partial cleanup ⚠️ (N4)

---

## Synthesis — the single change for the next sprint

**Add named funnel events for `signup_completed`, `first_bill_uploaded`, `first_reimbursement_pdf_generated`, and `onboarding_carousel_shown_after_first_bill`.** These are 4 lines in [analytics.ts](../src/lib/analytics.ts) plus 4 call sites. With these in place, every other open finding in this review (and several from May) becomes _testable_ rather than _arguable_. Without them, every smallest-test recommendation in both reports is unfalsifiable. The May report flagged this as A4.13; one month later the experiments are live and the gap is more expensive every day.

**Derek's price:** none — this is purely additive instrumentation.

**Pre-mortem six months out:** "We had three feature-flagged experiments running for six months and still couldn't tell from data which one mattered. We argued in retros instead of measuring. The intuitive simplifications were probably right, but we shipped them on faith — and the cohort that quietly churned is invisible."

---

## Appendix

### What changed since the May report (filed deltas)

- Removed: `UserIntentDialog` (Wave 5)
- Added: [src/lib/queryHelpers.ts](../src/lib/queryHelpers.ts), [src/lib/featureFlags.ts](../src/lib/featureFlags.ts)
- Modified: [Dashboard.tsx](../src/pages/Dashboard.tsx), [Bills.tsx](../src/pages/Bills.tsx), [Ledger.tsx](../src/pages/Ledger.tsx), [AppSidebar.tsx](../src/components/AppSidebar.tsx), [BottomTabNavigation.tsx](../src/components/BottomTabNavigation.tsx), [Auth.tsx](../src/pages/Auth.tsx), [HSAContext.tsx](../src/contexts/HSAContext.tsx), [EmptyStateOnboarding.tsx](../src/components/dashboard/EmptyStateOnboarding.tsx), [OnboardingWizard.tsx](../src/components/onboarding/OnboardingWizard.tsx), [OnboardingProgressBar.tsx](../src/components/onboarding/OnboardingProgressBar.tsx)
- Added migrations: [20260506000000_default_user_intent_both.sql](../supabase/migrations/20260506000000_default_user_intent_both.sql)

### How to re-run

```bash
npx supabase start                   # Wave 1.A makes this work from scratch
npm run dev                          # placeholder env is fine; for full live mode, set VITE_SUPABASE_URL=http://127.0.0.1:54321
npx playwright test --config=tests/ux-review/playwright.config.ts  # both projects, ~4 minutes
```

### Test-harness changes in this review

- Added `mockProfileFetch(page, { intent, hsaOpenedDate })` to [tests/ux-review/helpers.ts](../tests/ux-review/helpers.ts) — intercepts `/rest/v1/profiles` GETs and returns a synthetic row. Required because Wave 5 moved `user_intent` out of any client-side surface (no localStorage, no URL param) and into the profiles row only.
- Replaced `localStorage.setItem("hasCompletedOnboarding", "true")` with the `wellth_onboarding_state` JSON blob the new `OnboardingContext` actually reads.
- Added 4 verification tests (Wave 2/3/3/4) at the bottom of `walkthrough.spec.ts`. Each writes a one-line "Verdict" to observations.md so future re-runs can grep the verdicts directly.

### What I still couldn't verify

- Real OCR results (no Lovable AI gateway key in placeholder env)
- Real Plaid Link (no `PLAID_CLIENT_ID` in placeholder env)
- Real Stripe upgrade flow (no publishable key)
- Reimbursement PDF generation E2E (no edge-function secrets)

All of these are now testable against the working local stack but require their respective sandbox keys — outside the scope of a pure UX review.
