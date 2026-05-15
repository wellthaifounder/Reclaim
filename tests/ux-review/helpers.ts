import { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = path.join(__dirname, "_artifacts");
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, "screenshots");
const NOTES_PATH = path.join(ARTIFACTS_DIR, "observations.md");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

let consoleLog: { type: string; text: string; url: string }[] = [];

export function attachConsoleCapture(page: Page) {
  consoleLog = [];
  page.on("console", (msg) => {
    consoleLog.push({ type: msg.type(), text: msg.text(), url: page.url() });
  });
  page.on("pageerror", (err) => {
    consoleLog.push({ type: "pageerror", text: err.message, url: page.url() });
  });
}

export function getConsoleLog() {
  return consoleLog;
}

let snapCounter = 0;
export async function snap(page: Page, label: string) {
  snapCounter++;
  const safe = label.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const fp = path.join(
    SCREENSHOTS_DIR,
    `${String(snapCounter).padStart(3, "0")}-${safe}.png`,
  );
  try {
    await page.screenshot({ path: fp, fullPage: true });
  } catch {
    // ignore screenshot failures (e.g. mid-navigation)
  }
  return fp;
}

export function note(persona: string, section: string, body: string) {
  const line = `\n## [${persona}] ${section}\n${body}\n`;
  fs.appendFileSync(NOTES_PATH, line, "utf-8");
}

export function resetNotes() {
  snapCounter = 0;
  fs.writeFileSync(
    NOTES_PATH,
    `# UX Review Observations\n\nGenerated: ${new Date().toISOString()}\n`,
    "utf-8",
  );
}

// ── Stubbed Supabase session ─────────────────────────────────────────────────
// Injects a fake session into localStorage so ProtectedRoute treats the user
// as authenticated. Network calls to Supabase still fail (placeholder URL),
// but data-fetching components catch errors gracefully and render empty states
// — which is exactly Maya's brand-new-zero-data experience.

export interface StubProfile {
  userId?: string;
  email?: string;
  fullName?: string;
  /** "billing" | "hsa" | "both" — drives which UI surfaces appear. Wave 5
   * removed UserIntentDialog; user_intent now lives in profiles row only.
   * To inject for tests, see {@link mockProfileFetch}. */
  intent?: "billing" | "hsa" | "both" | null;
  /** YYYY-MM-DD; needed for HSA-eligibility filtering */
  hsaOpenedDate?: string | null;
  /** OnboardingContext stores its state under "wellth_onboarding_state" as a
   * JSON blob keyed by feature. We mirror just the hasCompletedOnboarding
   * field here. */
  hasCompletedOnboarding?: boolean;
}

export async function stubSession(page: Page, profile: StubProfile = {}) {
  const userId = profile.userId ?? "00000000-0000-0000-0000-000000000001";
  const email = profile.email ?? "ux-test@wellth.local";
  const fullName = profile.fullName ?? "UX Test User";

  await page.addInitScript(
    ({ userId, email, fullName, hasCompletedOnboarding }) => {
      const session = {
        access_token: "fake.jwt.access",
        refresh_token: "fake.refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email,
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: { full_name: fullName },
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
      // Cover candidate storage keys supabase-js v2 may use. v2's default key is
      // `sb-${host.split('.')[0]}-auth-token`. Hosts seen in this repo:
      //   placeholder.supabase.co        -> sb-placeholder-auth-token
      //   <project>.supabase.co          -> sb-<project>-auth-token
      //   127.0.0.1:54321 (local stack)  -> sb-127-auth-token
      const stored = JSON.stringify(session);
      localStorage.setItem("sb-placeholder-auth-token", stored);
      localStorage.setItem("sb-127-auth-token", stored);
      localStorage.setItem("sb-localhost-auth-token", stored);
      localStorage.setItem("supabase.auth.token", stored);

      if (hasCompletedOnboarding) {
        // OnboardingContext storage shape — see src/contexts/OnboardingContext.tsx
        localStorage.setItem(
          "wellth_onboarding_state",
          JSON.stringify({ hasCompletedOnboarding: true }),
        );
      }
    },
    {
      userId,
      email,
      fullName,
      hasCompletedOnboarding: profile.hasCompletedOnboarding ?? false,
    },
  );
}

// ── Profile mock for Wave-5 user_intent injection ───────────────────────────
// HSAContext fetches `profiles.hsa_opened_date, user_intent` via the Supabase
// REST endpoint `/rest/v1/profiles`. With placeholder env it 4xx's, leaving
// userIntent=null (HSA-shaped path). To exercise the FF.AUTO_DISMISS_…_BILLING
// branch we have to intercept the REST call and respond with a synthetic row.
export async function mockProfileFetch(
  page: Page,
  profile: {
    intent?: "billing" | "hsa" | "both";
    hsaOpenedDate?: string | null;
  } = {},
) {
  const intent = profile.intent ?? "both";
  const hsa_opened_date = profile.hsaOpenedDate ?? null;

  await page.route(
    (url) =>
      url.pathname.includes("/rest/v1/profiles") ||
      // local supabase paths
      /\/rest\/v1\/profiles/i.test(url.toString()),
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      const body = JSON.stringify([{ user_intent: intent, hsa_opened_date }]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Content-Range": "0-0/1",
          "Access-Control-Allow-Origin": "*",
        },
        body,
      });
    },
  );
}

export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

/** Pages worth visiting in the route-coverage walkthrough. */
export const ROUTES = {
  public: [
    { path: "/", label: "landing" },
    { path: "/auth", label: "auth-signin" },
    { path: "/calculator", label: "calculator" },
    { path: "/privacy", label: "privacy-policy" },
  ],
  protected: [
    { path: "/dashboard", label: "dashboard" },
    { path: "/bills", label: "bills-list" },
    { path: "/bills/new", label: "bills-new" },
    { path: "/bills/upload", label: "bills-upload-duplicate" },
    { path: "/ledger", label: "ledger" },
    { path: "/collections", label: "collections" },
    { path: "/transactions", label: "transactions" },
    { path: "/reimbursement-requests", label: "reimbursement-requests" },
    { path: "/hsa-reimbursement", label: "hsa-reimbursement" },
    { path: "/savings-calculator", label: "savings-calculator" },
    { path: "/hsa-eligibility", label: "hsa-eligibility" },
    { path: "/bank-accounts", label: "bank-accounts" },
    { path: "/documents", label: "documents" },
    { path: "/reports", label: "reports" },
    { path: "/settings", label: "settings" },
    { path: "/guide", label: "guide" },
    { path: "/user-reviews", label: "user-reviews" },
  ],
};
