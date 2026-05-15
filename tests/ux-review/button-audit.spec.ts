import { test, expect, Page } from "@playwright/test";
import {
  attachConsoleCapture,
  getConsoleLog,
  snap,
  note,
  stubSession,
  mockProfileFetch,
  ROUTES,
} from "./helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = path.join(__dirname, "_artifacts");
const AUDIT_PATH = path.join(ARTIFACTS_DIR, "button-audit.md");

test.describe.configure({ mode: "serial" });

// Per-test budget — some pages have 30+ buttons; default 60s isn't enough.
test.setTimeout(180_000);

// ── Destructive button patterns (skip clicking) ──────────────────────────────
const DESTRUCTIVE = [
  /^sign out$/i,
  /^log ?out$/i,
  /^delete/i,
  /^remove/i,
  /^disconnect/i,
  /^cancel subscription/i,
  /^unsubscribe/i,
  /^revoke/i,
  /^archive/i,
  /^reset/i,
  /^clear all/i,
  /^purge/i,
  /^upgrade/i, // would trigger Stripe checkout flow
  /^subscribe/i,
  /^connect.*bank/i, // would open Plaid Link
  /^connect.*plaid/i,
  /^link.*account/i,
];

function isDestructive(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return DESTRUCTIVE.some((re) => re.test(trimmed));
}

// ── Audit log appender ───────────────────────────────────────────────────────
function appendAudit(section: string, body: string) {
  fs.appendFileSync(AUDIT_PATH, `\n## ${section}\n${body}\n`, "utf-8");
}

function resetAudit() {
  if (!fs.existsSync(ARTIFACTS_DIR))
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  // Append-only: if the audit file already exists, only add a session header.
  // This lets us re-run a subset of tests via --grep without losing prior pass.
  if (fs.existsSync(AUDIT_PATH) && fs.statSync(AUDIT_PATH).size > 0) {
    fs.appendFileSync(
      AUDIT_PATH,
      `\n---\n\n## Re-run session ${new Date().toISOString()}\n\n`,
      "utf-8",
    );
    return;
  }
  fs.writeFileSync(
    AUDIT_PATH,
    `# Button-by-button Audit\n\nGenerated: ${new Date().toISOString()}\n\nApproach: visit every reachable page (public + protected), enumerate every visible interactive element (button, role=button, role=tab, link with role=button), click each (skipping destructive patterns), and record what happened — URL change, modal open, console error, no-op.\n\n`,
    "utf-8",
  );
}

// ── Mock all backend traffic so we can test UI behavior in isolation ────────
async function installBackendMocks(page: Page) {
  // Block Supabase REST traffic and edge functions — fulfill with empty payloads
  await page.route(/\/rest\/v1\/(?!profiles)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Content-Range": "0-0/0" },
      body: "[]",
    });
  });
  await page.route(/\/functions\/v1\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });
  // Block all Plaid/Stripe iframes
  await page.route(/plaid\.com|stripe\.com|js\.stripe\.com/, (route) =>
    route.abort(),
  );
}

// ── Try to dismiss any visible modal/dialog ─────────────────────────────────
async function dismissOverlay(page: Page) {
  // Click any visible close button on a dialog
  for (const sel of [
    "[role='dialog'] [aria-label*='close' i]",
    "[role='alertdialog'] [aria-label*='close' i]",
    "button[aria-label='Close']",
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
  // Escape as fallback
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
}

// ── Audit a single page ──────────────────────────────────────────────────────
interface ButtonProbe {
  text: string;
  type: string;
  visible: boolean;
  disabled: boolean;
}
interface ClickOutcome {
  text: string;
  navigated: boolean;
  newUrl: string;
  dialogOpened: boolean;
  consoleErrorAfter: string | null;
  skipped: boolean;
  skipReason?: string;
  threw: string | null;
}

async function enumerateButtons(page: Page): Promise<ButtonProbe[]> {
  // Collect button-like elements with their text
  const probes = await page.$$eval(
    "button, [role='button'], [role='tab'], a[role='button']",
    (els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          window.getComputedStyle(el).visibility !== "hidden" &&
          window.getComputedStyle(el).display !== "none";
        const text =
          (el as HTMLElement).innerText?.trim() ||
          el.getAttribute("aria-label")?.trim() ||
          el.getAttribute("title")?.trim() ||
          "";
        return {
          text,
          type:
            el.tagName.toLowerCase() +
            (el.getAttribute("role")
              ? `[role=${el.getAttribute("role")}]`
              : ""),
          visible,
          disabled:
            (el as HTMLButtonElement).disabled ||
            el.getAttribute("aria-disabled") === "true",
        };
      }),
  );
  return probes;
}

async function clickByText(page: Page, text: string): Promise<ClickOutcome> {
  const startUrl = page.url();
  const consoleErrsBefore = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  ).length;

  if (!text.trim()) {
    return {
      text,
      navigated: false,
      newUrl: startUrl,
      dialogOpened: false,
      consoleErrorAfter: null,
      skipped: true,
      skipReason: "(empty text)",
      threw: null,
    };
  }
  if (isDestructive(text)) {
    return {
      text,
      navigated: false,
      newUrl: startUrl,
      dialogOpened: false,
      consoleErrorAfter: null,
      skipped: true,
      skipReason: "destructive pattern",
      threw: null,
    };
  }

  // Build a locator. Prefer exact match; fall back to substring.
  // Many UI libraries duplicate the same label so .first() is required.
  let locator = page.getByRole("button", { name: text, exact: true }).first();
  if ((await locator.count()) === 0) {
    locator = page.getByText(text, { exact: true }).first();
  }

  let threw: string | null = null;
  try {
    await locator.click({ timeout: 2000, trial: false });
  } catch (e: any) {
    threw = (e?.message || String(e)).slice(0, 120);
  }

  await page.waitForTimeout(400); // let any nav / modal animate

  const newUrl = page.url();
  const navigated = newUrl !== startUrl;
  const dialogOpened =
    (await page
      .locator("[role='dialog'], [role='alertdialog']")
      .first()
      .isVisible()
      .catch(() => false)) || false;

  const errsAfter = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  );
  const newErr =
    errsAfter.length > consoleErrsBefore
      ? errsAfter[errsAfter.length - 1].text.slice(0, 200)
      : null;

  return {
    text,
    navigated,
    newUrl,
    dialogOpened,
    consoleErrorAfter: newErr,
    skipped: false,
    threw,
  };
}

async function auditPage(
  page: Page,
  routePath: string,
  routeLabel: string,
): Promise<void> {
  const errsBefore = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  ).length;

  // Visit page fresh
  await page.goto(routePath, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500); // settle for async render
  await snap(page, `audit-${routeLabel}-initial`);

  // Dismiss any onboarding wizard / modal that auto-opens
  await dismissOverlay(page);
  await page.waitForTimeout(200);

  const renderedHeading = await page
    .locator("h1, h2, h3")
    .first()
    .innerText({ timeout: 2000 })
    .catch(() => "(no heading)");

  const probes = await enumerateButtons(page);
  const visible = probes.filter((p) => p.visible);
  const uniqueByText = Array.from(
    new Map(visible.map((p) => [p.text, p])).values(),
  );

  // Render-time errors
  const errsAfterRender = getConsoleLog().filter(
    (l) => l.type === "error" || l.type === "pageerror",
  );
  const renderErrors = errsAfterRender.slice(errsBefore).slice(0, 5);

  const outcomes: ClickOutcome[] = [];
  for (const probe of uniqueByText) {
    if (probe.disabled) {
      outcomes.push({
        text: probe.text,
        navigated: false,
        newUrl: page.url(),
        dialogOpened: false,
        consoleErrorAfter: null,
        skipped: true,
        skipReason: "disabled",
        threw: null,
      });
      continue;
    }
    // Re-navigate to original page between clicks so we exercise from a clean state
    if (page.url() !== `http://localhost:8080${routePath}`) {
      await page
        .goto(routePath, { waitUntil: "domcontentloaded", timeout: 8000 })
        .catch(() => {});
      await page
        .waitForLoadState("networkidle", { timeout: 4000 })
        .catch(() => {});
      await dismissOverlay(page);
      await page.waitForTimeout(150);
    } else {
      await dismissOverlay(page);
    }

    const outcome = await clickByText(page, probe.text);
    outcomes.push(outcome);

    // If a dialog opened, close it before continuing
    if (outcome.dialogOpened) {
      await dismissOverlay(page);
    }
  }

  // Build report section
  const lines: string[] = [];
  lines.push(`**Route:** \`${routePath}\` (${routeLabel})`);
  lines.push(
    `**Landed at:** ${page.url().replace("http://localhost:8080", "")}`,
  );
  lines.push(`**First heading:** "${renderedHeading.slice(0, 80)}"`);
  lines.push(
    `**Buttons found:** ${probes.length} total, ${visible.length} visible, ${uniqueByText.length} unique`,
  );
  if (renderErrors.length) {
    lines.push(`**Render-time console errors:**`);
    for (const e of renderErrors) {
      lines.push(`  - [${e.type}] ${e.text.slice(0, 160)}`);
    }
  }
  lines.push(``);
  lines.push(`| Button | Outcome | Notes |`);
  lines.push(`|---|---|---|`);
  for (const o of outcomes) {
    const label = o.text.replace(/\|/g, "\\|").slice(0, 50) || "(empty)";
    let outcome: string;
    if (o.skipped) outcome = `⏭ skipped (${o.skipReason})`;
    else if (o.threw) outcome = `❌ threw`;
    else if (o.navigated)
      outcome = `→ ${o.newUrl.replace("http://localhost:8080", "") || "/"}`;
    else if (o.dialogOpened) outcome = `🪟 dialog`;
    else outcome = `· no nav`;
    const notes = [
      o.threw ? `err: ${o.threw}` : "",
      o.consoleErrorAfter ? `console: ${o.consoleErrorAfter}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`| ${label} | ${outcome} | ${notes} |`);
  }
  appendAudit(`Route: ${routePath}`, lines.join("\n"));
}

// ────────────────────────────────────────────────────────────────────────────
// SETUP
// ────────────────────────────────────────────────────────────────────────────

test.beforeAll(() => {
  resetAudit();
});

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ────────────────────────────────────────────────────────────────────────────

for (const route of ROUTES.public) {
  test(`audit public: ${route.path}`, async ({ page }) => {
    attachConsoleCapture(page);
    await installBackendMocks(page);
    await auditPage(page, route.path, route.label);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES (stubbed auth, hsa intent)
// ────────────────────────────────────────────────────────────────────────────

for (const route of ROUTES.protected) {
  test(`audit protected (hsa intent): ${route.path}`, async ({ page }) => {
    attachConsoleCapture(page);
    await installBackendMocks(page);
    await mockProfileFetch(page, {
      intent: "hsa",
      hsaOpenedDate: "2024-01-01",
    });
    await stubSession(page, {
      fullName: "Audit User",
      email: "audit@ux-review.local",
      hasCompletedOnboarding: true,
    });
    await auditPage(page, route.path, route.label);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES — billing intent variant (smaller, to catch divergent UI)
// ────────────────────────────────────────────────────────────────────────────

const BILLING_INTENT_PAGES = [
  { path: "/dashboard", label: "dashboard-billing" },
  { path: "/bills", label: "bills-billing" },
  { path: "/settings", label: "settings-billing" },
];

for (const route of BILLING_INTENT_PAGES) {
  test(`audit protected (billing intent): ${route.path}`, async ({ page }) => {
    attachConsoleCapture(page);
    await installBackendMocks(page);
    await mockProfileFetch(page, { intent: "billing", hsaOpenedDate: null });
    await stubSession(page, {
      fullName: "Audit Billing",
      email: "audit-billing@ux-review.local",
      hasCompletedOnboarding: true,
    });
    await auditPage(page, route.path, route.label);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// MOBILE PARITY — same audit at 390x844
// ────────────────────────────────────────────────────────────────────────────

const MOBILE_AUDIT_PAGES = [
  { path: "/dashboard", label: "mobile-dashboard" },
  { path: "/bills", label: "mobile-bills" },
  { path: "/settings", label: "mobile-settings" },
  { path: "/bills/new", label: "mobile-bills-new" },
];

for (const route of MOBILE_AUDIT_PAGES) {
  test(`audit mobile 390px: ${route.path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    attachConsoleCapture(page);
    await installBackendMocks(page);
    await mockProfileFetch(page, { intent: "both" });
    await stubSession(page, {
      fullName: "Audit Mobile",
      hasCompletedOnboarding: true,
    });
    await auditPage(page, route.path, route.label);
  });
}
