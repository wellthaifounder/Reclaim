// Simple env-var-driven feature flags. Read at module load (Vite inlines
// import.meta.env values at build time, so changes require a redeploy).
// Set in Vercel env vars or a local .env. Treat any value other than "true"
// (case-insensitive) as off.

function flag(name: string): boolean {
  return (
    String(import.meta.env[name] ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * Like `flag(name)` but defaults to `true` when the env var is unset. Only the
 * literal value "false" disables. Used after the 2026-05-06 commit-the-defaults
 * decision: with no live users, the experiment outcomes are predetermined by
 * intent, so we ship the on-state by default but keep the env override as a
 * fast escape hatch in case post-launch reality contradicts.
 */
function flagOnByDefault(name: string): boolean {
  const raw = String(import.meta.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (raw === "false") return false;
  return true;
}

/**
 * Wave 3 (2026-05) experiment flags. Both default off until telemetry
 * supports the experiment. See docs/ux-review-2026-05.md §3 + §5 pre-mortem.
 */
export const FF = {
  /**
   * Auto-dismiss the OnboardingWizard carousel for users who picked
   * `userIntent === 'billing'`. The carousel still exists for HSA-intent
   * users who need the tax-advantage explanation.
   *
   * Set VITE_FF_AUTO_DISMISS_ONBOARDING_FOR_BILLING=true to enable.
   */
  AUTO_DISMISS_ONBOARDING_FOR_BILLING: flagOnByDefault(
    "VITE_FF_AUTO_DISMISS_ONBOARDING_FOR_BILLING",
  ),

  /**
   * Show the Get-Started progress ribbon only on /dashboard. Currently
   * persists on every authenticated page, becoming a "shame bar" reminder
   * of what the user hasn't done.
   *
   * Set VITE_FF_SCOPE_GET_STARTED_TO_DASHBOARD=true to enable.
   */
  SCOPE_GET_STARTED_TO_DASHBOARD: flagOnByDefault(
    "VITE_FF_SCOPE_GET_STARTED_TO_DASHBOARD",
  ),

  /**
   * Wave 4 (2026-05) — IA collapse experiment. When on:
   *   - /ledger redirects to /bills?view=ledger
   *   - Bills page reads ?view, renders Ledger view inline when view=ledger
   *   - Sidebar drops the standalone "Ledger" item; bottom-tab repoints
   *
   * Smallest reversible test of merging Bills + Ledger IA. Hold ≥7 days of
   * `bills_view_selected` telemetry before deciding to widen or revert.
   *
   * Set VITE_FF_BILLS_LEDGER_IA_COLLAPSE=true to enable.
   */
  BILLS_LEDGER_IA_COLLAPSE: flagOnByDefault("VITE_FF_BILLS_LEDGER_IA_COLLAPSE"),

  /**
   * Wellbie AI assistant (chat + mascot). OFF by default for the Reclaim soft
   * launch — conversational chat is a v1.1 item, and shipping a half-surfaced
   * assistant dilutes the launch. All Wellbie entry points (nav button, bottom
   * tab, dashboard tip, "Ask Wellbie" cards, pricing lines, /wellbie route) are
   * gated on this. Code + DB tables are retained for re-enable.
   *
   * Set VITE_FF_WELLBIE_ENABLED=true to bring it back.
   */
  WELLBIE_ENABLED: flag("VITE_FF_WELLBIE_ENABLED"),
} as const;
