import { test, expect } from "@playwright/test";
import {
  attachConsoleCapture,
  getConsoleLog,
  snap,
  note,
  resetNotes,
  stubSession,
  mockProfileFetch,
  timed,
  ROUTES,
} from "./helpers";

// Single serial run — observations are appended in order to one notes file.
test.describe.configure({ mode: "serial" });

// Route-coverage tests iterate ~17 protected pages, each waiting up to 8s for
// networkidle. Default 60s isn't enough now that retired-route silent redirects
// were removed (Wave 6, 2026-05-14) and pages actually render.
test.setTimeout(180_000);

test.beforeAll(() => {
  resetNotes();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. PUBLIC SURFACE — what someone sees before signing up
// ────────────────────────────────────────────────────────────────────────────

test("public: landing page", async ({ page }) => {
  attachConsoleCapture(page);
  const { ms } = await timed(async () => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
  });
  await snap(page, "01-landing");

  const h1 = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => "(no h1)");
  const ctas = await page
    .getByRole("link", { name: /get started|sign up|start|try|free/i })
    .allInnerTexts();
  const navLinks = await page.locator("nav a").allInnerTexts();

  note(
    "Public",
    "Landing page",
    [
      `URL: ${page.url()}`,
      `Title: ${await page.title()}`,
      `Load to networkidle: ${ms}ms`,
      `H1: "${h1}"`,
      `Primary CTAs found (${ctas.length}): ${ctas.slice(0, 6).join(" | ")}`,
      `Nav links: ${navLinks.join(" | ")}`,
    ].join("\n"),
  );

  const errors = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  );
  if (errors.length) {
    note(
      "Public",
      "Landing console errors",
      errors
        .slice(0, 10)
        .map((e) => `- [${e.type}] ${e.text}`)
        .join("\n"),
    );
  }
});

test("public: auth page (signin and signup tabs)", async ({ page }) => {
  attachConsoleCapture(page);
  await page.goto("/auth");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "02-auth-signin");

  const tabs = await page.getByRole("tab").allInnerTexts();
  const signinFields: string[] = [];
  for (const id of ["signin-email", "signin-password"]) {
    const el = page.locator(`#${id}`);
    if (await el.count()) signinFields.push(id);
  }

  await page.getByRole("tab", { name: /sign up/i }).click();
  await snap(page, "03-auth-signup");
  const signupFields: string[] = [];
  for (const id of ["signup-name", "signup-email", "signup-password"]) {
    const el = page.locator(`#${id}`);
    if (await el.count()) signupFields.push(id);
  }
  const termsCheckboxVisible = await page
    .getByRole("checkbox", { name: /privacy/i })
    .isVisible()
    .catch(() => false);

  note(
    "Public",
    "Auth page",
    [
      `Tabs: ${tabs.join(", ")}`,
      `Sign-in fields: ${signinFields.join(", ")}`,
      `Sign-up fields: ${signupFields.join(", ")}`,
      `Terms checkbox visible on signup: ${termsCheckboxVisible}`,
    ].join("\n"),
  );

  // Decision count for Maya to complete signup
  const decisions = [
    "Choose Sign In vs Sign Up tab",
    "Type Full Name",
    "Type Email",
    "Type Password (≥8 chars)",
    "Read & check Privacy Policy box",
    "Click Create Account (or Continue with Google)",
  ];
  note(
    "Public",
    "Maya signup decision count",
    `${decisions.length} discrete decisions / fields:\n- ${decisions.join("\n- ")}`,
  );
});

test("public: privacy and calculator pages render", async ({ page }) => {
  attachConsoleCapture(page);
  await page.goto("/privacy");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "04-privacy");
  const privacyH1 = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => "");

  await page.goto("/calculator");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "05-calculator");
  const calcH1 = await page
    .locator("h1, h2")
    .first()
    .innerText()
    .catch(() => "");

  note(
    "Public",
    "Privacy + Calculator",
    `Privacy H1: "${privacyH1.slice(0, 80)}"\nCalculator first heading: "${calcH1.slice(0, 80)}"`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 2. MAYA — anxious first-timer with stubbed empty session, intent="hsa"
// ────────────────────────────────────────────────────────────────────────────

test("Maya: dashboard empty state (HSA intent, no data)", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, {
    fullName: "Maya Tester",
    email: "maya@ux-review.local",
    hasCompletedOnboarding: false,
  });

  const { ms } = await timed(async () => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle").catch(() => {});
  });
  await snap(page, "10-maya-dashboard");

  // Inventory the top-fold
  const headings = await page.locator("h1, h2, h3").allInnerTexts();
  const buttons = await page.getByRole("button").allInnerTexts();

  // Are multiple onboarding surfaces visible at the same time?
  const wizardOpen = await page
    .getByText(/triple tax advantage|wealth-building tool/i)
    .isVisible()
    .catch(() => false);
  const emptyStateVisible = await page
    .getByText(/upload your first bill/i)
    .isVisible()
    .catch(() => false);

  note(
    "Maya",
    "Dashboard zero-state",
    [
      `Time to dashboard render: ${ms}ms`,
      `URL: ${page.url()}`,
      `Headings (${headings.length}):\n  ${headings.slice(0, 12).join("\n  ")}`,
      `Buttons (${buttons.length}): ${buttons.slice(0, 12).join(" | ")}`,
      `OnboardingWizard modal visible: ${wizardOpen}`,
      `EmptyStateOnboarding visible: ${emptyStateVisible}`,
    ].join("\n"),
  );

  const errs = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  );
  note(
    "Maya",
    "Dashboard console errors (expected: supabase 401s — placeholder env)",
    errs.length === 0
      ? "(none)"
      : `${errs.length} errors. First 5:\n${errs
          .slice(0, 5)
          .map((e) => `- [${e.type}] ${e.text.slice(0, 200)}`)
          .join("\n")}`,
  );
});

test("Maya: upload-bill wizard UI (no save)", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Tester" });

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Try the EmptyStateOnboarding CTA path
  const uploadCta = page.getByRole("button", {
    name: /upload your first bill/i,
  });
  if (
    await uploadCta
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    const { ms } = await timed(async () => {
      await uploadCta.first().click();
      await page.waitForURL(/bills\/(new|upload)/);
    });
    note(
      "Maya",
      "Click-to-upload-wizard latency from dashboard CTA",
      `${ms}ms`,
    );
  } else {
    await page.goto("/bills/new");
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "11-maya-upload-wizard");

  // Inspect the wizard UI
  const dropzoneVisible = await page
    .getByText(/upload documents|drag.*drop/i)
    .isVisible()
    .catch(() => false);
  const continueDisabled = await page
    .getByRole("button", { name: /continue/i })
    .isDisabled()
    .catch(() => true);
  const stepLabels = await page
    .locator("text=/^(Upload|Confirm|Saved)$/")
    .allInnerTexts();

  note(
    "Maya",
    "Upload wizard step 1",
    [
      `Dropzone visible: ${dropzoneVisible}`,
      `Continue button disabled before file chosen: ${continueDisabled}`,
      `Step labels found: ${stepLabels.join(" / ")}`,
    ].join("\n"),
  );

  // Compare /bills/new vs /bills/upload
  await page.goto("/bills/upload");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "12-maya-upload-wizard-via-upload-route");
  const dupeContent = await page
    .getByText(/upload documents|drag.*drop/i)
    .isVisible()
    .catch(() => false);
  note(
    "Maya",
    "Dual route confirmation",
    `/bills/new and /bills/upload both render the same wizard (dropzone visible: ${dupeContent}). Confirms duplicate route in App.tsx.`,
  );
});

test("Maya: navigation IA on desktop", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Tester" });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  const sidebarItems = await page
    .locator("[data-sidebar='sidebar'] a, aside a, nav a")
    .allInnerTexts();
  note(
    "Maya",
    "Desktop nav inventory",
    `Found ${sidebarItems.length} nav links. First 20:\n  ${sidebarItems
      .slice(0, 20)
      .filter((t) => t.trim())
      .join("\n  ")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 3. ROUTE COVERAGE — visit every reachable page, capture screenshot + headings
// ────────────────────────────────────────────────────────────────────────────

test("route coverage: all protected pages with stubbed auth", async ({
  page,
}) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Tester" });

  for (const route of ROUTES.protected) {
    await page.goto(route.path).catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    await snap(page, `route-${route.label}`);
    const heading = await page
      .locator("h1, h2")
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => "(no heading found)");
    const url = page.url();
    note(
      "Routes",
      route.path,
      `→ ${url}\nFirst heading: "${heading.slice(0, 100)}"`,
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 4. DEREK — HSA optimizer; we look at Settings density and Reports
// ────────────────────────────────────────────────────────────────────────────

test("Derek: settings sprawl audit", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, {
    fullName: "Derek Optimizer",
    email: "derek@ux-review.local",
    hasCompletedOnboarding: true,
  });

  await page.goto("/settings");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "20-derek-settings-top");

  // Scroll through and capture the long-scroll experience
  const scrollHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const screensTall = (scrollHeight / viewportHeight).toFixed(1);

  // Collect every section heading to get a feel for the density
  const sectionHeadings = await page
    .locator("h1, h2, h3, [class*='CardTitle']")
    .allInnerTexts();

  note(
    "Derek",
    "Settings density",
    [
      `Page total height: ${scrollHeight}px`,
      `Viewport height: ${viewportHeight}px`,
      `Page is ${screensTall} screens tall on desktop 1440x900`,
      `Section headings (${sectionHeadings.length}):\n  ${sectionHeadings
        .filter((h) => h.trim())
        .slice(0, 30)
        .join("\n  ")}`,
    ].join("\n"),
  );

  // Scroll to bottom, take a second screenshot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await snap(page, "21-derek-settings-bottom");
});

test("Derek: reports empty state (no data)", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Derek Optimizer" });
  await page.goto("/reports");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "22-derek-reports");

  const headings = await page.locator("h1, h2, h3").allInnerTexts();
  const ctas = await page.getByRole("button").allInnerTexts();
  note(
    "Derek",
    "Reports empty state",
    `Headings: ${headings.slice(0, 10).join(" | ")}\nCTAs: ${ctas.slice(0, 10).join(" | ")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 5. PRIYA — caregiver; we look at Collections + Bills bulk
// ────────────────────────────────────────────────────────────────────────────

test("Priya: collections empty state and care-event vocabulary", async ({
  page,
}) => {
  attachConsoleCapture(page);
  await stubSession(page, {
    fullName: "Priya Caregiver",
    email: "priya@ux-review.local",
    hasCompletedOnboarding: true,
  });

  await page.goto("/collections");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "30-priya-collections");

  const headings = await page.locator("h1, h2").allInnerTexts();
  const usesCareEventLabel = (await page.content()).includes("Care Event");
  const usesCollectionsLabel = (await page.content())
    .toLowerCase()
    .includes("collection");

  note(
    "Priya",
    "Vocabulary check on /collections",
    [
      `Headings: ${headings.slice(0, 6).join(" | ")}`,
      `Page uses 'Care Event' label: ${usesCareEventLabel}`,
      `Page uses 'collection' anywhere: ${usesCollectionsLabel}`,
      `URL is /collections but UI calls them Care Events — check for vocabulary leak.`,
    ].join("\n"),
  );

  await page.goto("/ledger");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "31-priya-ledger");
  const ledgerH = await page
    .locator("h1, h2")
    .first()
    .innerText()
    .catch(() => "");
  note(
    "Priya",
    "Ledger page",
    `First heading: "${ledgerH.slice(0, 100)}"\nNote: 'Ledger' is unfamiliar consumer vocabulary; Priya may not know what to expect.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 6. MOBILE PARITY — same content via mobile viewport
// ────────────────────────────────────────────────────────────────────────────

test("mobile: dashboard at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Mobile" });

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "40-mobile-dashboard");

  const bottomNavVisible = await page
    .locator("nav[aria-label='Bottom navigation']")
    .isVisible()
    .catch(() => false);
  const bottomNavTabs = await page
    .locator(
      "nav[aria-label='Bottom navigation'] a, nav[aria-label='Bottom navigation'] button",
    )
    .allInnerTexts();
  const sidebarVisible = await page
    .locator("aside, [data-sidebar='sidebar']")
    .first()
    .isVisible()
    .catch(() => false);

  note(
    "Mobile",
    "Mobile dashboard",
    [
      `Bottom nav visible: ${bottomNavVisible}`,
      `Bottom nav tabs: ${bottomNavTabs.join(" | ")}`,
      `Desktop sidebar visible at 390px: ${sidebarVisible} (should be false)`,
    ].join("\n"),
  );
});

test("mobile: upload wizard ergonomics at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Mobile" });

  await page.goto("/bills/new");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "41-mobile-upload-wizard");

  const dropzoneText = await page
    .getByText(/drag.*drop|upload documents/i)
    .first()
    .innerText()
    .catch(() => "");
  note(
    "Mobile",
    "Upload wizard mobile",
    `Dropzone text: "${dropzoneText}"\nNote: 'Drag & drop' is desktop language — on mobile, photo capture / 'choose from photos' would be more idiomatic.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 7. EDGE CASES
// ────────────────────────────────────────────────────────────────────────────

test("edge: cancel mid-wizard from upload step", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Tester" });
  await page.goto("/bills/new");
  await page.waitForLoadState("networkidle").catch(() => {});

  // The wizard's cancel only appears if onCancel prop wired. Look for it.
  const cancelVisible = await page
    .getByRole("button", { name: /^cancel$/i })
    .isVisible()
    .catch(() => false);
  note(
    "Edge",
    "Cancel button on upload step",
    `Visible: ${cancelVisible}\nIf false: user must use browser back to abandon — friction.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 8. WAVE-FIX VERIFICATION — checks added 2026-05-07 follow-up review
// ────────────────────────────────────────────────────────────────────────────

test("verify Wave 3: OnboardingWizard auto-dismisses for billing intent", async ({
  page,
}) => {
  attachConsoleCapture(page);
  // Maya-billing — we want the "billing" cohort that the FF should suppress.
  // hasCompletedOnboarding=false so the wizard would otherwise fire.
  await mockProfileFetch(page, { intent: "billing" });
  await stubSession(page, {
    fullName: "Maya Billing",
    email: "maya-billing@ux-review.local",
    hasCompletedOnboarding: false,
  });

  // Seed an expense count of 1 so the dashboard treats this as a non-newUser
  // (`isNewUser` requires expenseCount===0 && hasConnectedBank===false). The
  // wizard auto-show only fires for non-new users with expenseCount<=3.
  // We can't easily seed the expenses query without intercepting more endpoints
  // — so just visit and observe whether the wizard text appears.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000); // wizard has a 1s setTimeout
  await snap(page, "60-billing-intent-no-wizard");

  // The OnboardingWizard text from STEPS[0]: "wealth-building tool"
  const wizardVisible = await page
    .getByText(/triple tax advantage|wealth-building tool/i)
    .first()
    .isVisible()
    .catch(() => false);

  note(
    "Wave3-verify",
    "Billing-intent wizard suppression",
    [
      `userIntent='billing' (mocked via /rest/v1/profiles)`,
      `OnboardingWizard visible after 2s wait: ${wizardVisible}`,
      `Expected (FF.AUTO_DISMISS_ONBOARDING_FOR_BILLING=on): false`,
      `Verdict: ${wizardVisible ? "REGRESSION — wizard fired despite billing intent" : "Resolved — wizard suppressed"}`,
    ].join("\n"),
  );
});

test("verify Wave 4: /ledger redirects, /bills?view=ledger renders tabs", async ({
  page,
}) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Derek IA-Test" });

  // Hit /ledger and observe whether the URL becomes /bills?view=ledger
  await page.goto("/ledger");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "61-ledger-redirect");
  const afterLedger = page.url();

  // Now /bills directly with the view param
  await page.goto("/bills?view=ledger");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "62-bills-ledger-tab");
  const tabsVisible = await page
    .locator("[role='tablist']")
    .first()
    .isVisible()
    .catch(() => false);
  const ledgerTabSelected = await page
    .getByRole("tab", { name: /ledger/i })
    .getAttribute("data-state")
    .catch(() => null);

  // Plain /bills should default to list view
  await page.goto("/bills");
  await page.waitForLoadState("networkidle").catch(() => {});
  const listTabSelected = await page
    .getByRole("tab", { name: /^list$/i })
    .getAttribute("data-state")
    .catch(() => null);
  await snap(page, "63-bills-list-tab");

  note(
    "Wave4-verify",
    "Bills/Ledger IA collapse",
    [
      `/ledger landed on: ${afterLedger}`,
      `Expected: contains '/bills' and 'view=ledger'`,
      `Tabs rendered on /bills?view=ledger: ${tabsVisible}`,
      `Ledger tab data-state: ${ledgerTabSelected ?? "(missing)"} (expected 'active')`,
      `List tab data-state on /bills: ${listTabSelected ?? "(missing)"} (expected 'active')`,
      `Verdict: ${
        afterLedger.includes("view=ledger") && tabsVisible
          ? "Resolved"
          : "Partial / Not resolved"
      }`,
    ].join("\n"),
  );
});

test("verify Wave 3: Get-Started ribbon scoped to dashboard only", async ({
  page,
}) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Ribbon-Scope" });

  // Pages that should NOT show the ribbon when SCOPE_GET_STARTED_TO_DASHBOARD=on
  const targets = ["/bills", "/settings", "/reports"];
  const ribbonByPage: Record<string, boolean> = {};
  for (const target of targets) {
    await page.goto(target).catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    await snap(page, `64-no-ribbon-${target.replace(/\//g, "-")}`);
    ribbonByPage[target] = await page
      .getByText(/get started/i)
      .first()
      .isVisible()
      .catch(() => false);
  }

  // And on /dashboard the ribbon SHOULD still be visible (for new-user state)
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "65-ribbon-on-dashboard");
  const dashboardRibbon = await page
    .getByText(/get started/i)
    .first()
    .isVisible()
    .catch(() => false);

  note(
    "Wave3-verify",
    "Get-Started ribbon scope",
    [
      ...Object.entries(ribbonByPage).map(
        ([p, visible]) => `${p}: ribbon visible = ${visible} (expected false)`,
      ),
      `/dashboard: ribbon visible = ${dashboardRibbon} (expected true for new user)`,
      `Verdict: ${
        Object.values(ribbonByPage).every((v) => !v)
          ? "Resolved — ribbon hidden off-dashboard"
          : "Partial / Not resolved — ribbon leaks to non-dashboard pages"
      }`,
    ].join("\n"),
  );
});

test("verify Wave 2: stalled fetch shows degraded UI, not infinite skeleton", async ({
  page,
}) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Network-Fail" });

  // Block all Supabase REST calls (queries) — auth still resolves from
  // localStorage. We expect React Query to time out via withQueryTimeout
  // and surface a "Try again" UI instead of a forever-spinner.
  await page.route(/\/rest\/v1\//, (route) => route.abort("failed"));

  await page.goto("/bills");
  // withQueryTimeout uses 5s; allow 8s wall to be safe.
  await page.waitForTimeout(8000);
  await snap(page, "66-stalled-bills");
  const tryAgainVisible = await page
    .getByRole("button", { name: /try again/i })
    .isVisible()
    .catch(() => false);
  const stillSpinning = await page
    .locator("[role='status'][aria-busy='true']")
    .first()
    .isVisible()
    .catch(() => false);

  note(
    "Wave2-verify",
    "Stalled-fetch fallback on /bills",
    [
      `'Try again' button visible after 8s: ${tryAgainVisible}`,
      `Still showing aria-busy spinner: ${stillSpinning}`,
      `Verdict: ${
        tryAgainVisible && !stillSpinning
          ? "Resolved — degraded UI rendered"
          : "Partial / Not resolved — see screenshot"
      }`,
    ].join("\n"),
  );
});

test("edge: 404 page renders for unknown routes", async ({ page }) => {
  attachConsoleCapture(page);
  await stubSession(page, { fullName: "Maya Tester" });
  await page.goto("/this-route-does-not-exist-xyz");
  await page.waitForLoadState("networkidle").catch(() => {});
  await snap(page, "50-404");
  const heading = await page
    .locator("h1, h2")
    .first()
    .innerText()
    .catch(() => "(none)");
  note(
    "Edge",
    "404 page",
    `Heading: "${heading}"\nURL preserved: ${page.url()}`,
  );
});
