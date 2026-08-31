#!/usr/bin/env node
/**
 * Stop hook — the checks that must pass before a turn is allowed to end.
 *
 * CLAUDE.md already states what "done" means for this repo: the build gate
 * passes, no secret leaves src/, every migration keeps row-level security and
 * a pinned search_path, every edge function authenticates and pins its CORS
 * origin. Those rules were enforced by whoever remembered to read them. This
 * runs them.
 *
 * SCOPE. Only files actually written this turn, recorded by on-file-change.mjs
 * in .claude/.done-checks-pending. Nothing written, nothing checked, and the
 * hook exits in milliseconds. This matters because the repo carries ~140
 * pre-existing lint problems: a whole-repo gate would fail on every turn and
 * be switched off within a day, which is the usual fate of a gate that cries
 * wolf. Changed files only means a clean signal about work just done.
 *
 * WHAT IT DELIBERATELY DOES NOT RUN. `vite build` (the typecheck it gates on
 * is run directly, and bundling adds a minute to prove nothing extra) and
 * `supabase db reset` (89 migrations against Docker — far too slow for every
 * turn). When migrations change, the hook says so and leaves the reset to a
 * human decision.
 *
 * FAILING IS ADVICE, NOT A CAGE. A failure blocks at most MAX_BLOCKS times for
 * the same batch of files, then reports and lets the turn end. A hook that can
 * trap a session in a loop is worse than one that occasionally lets something
 * through. Set RECLAIM_SKIP_DONE_CHECKS=1, or create .claude/.done-checks-off,
 * to silence it entirely.
 *
 * Exit codes are the Claude Code hook contract: 0 = allow the turn to end
 * (stdout is informational), 2 = block and feed stderr back for fixing.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

// exec, not execFile+shell:true — the latter concatenates argv into a shell
// line anyway and node deprecation-warns about it. npx needs a shell on
// Windows, so the command is built as one already-quoted string.
const run = promisify(exec);
const q = (s) => `"${s}"`;
const MAX_BLOCKS = 2;

// ── secret patterns ──────────────────────────────────────────────────────────
// Assignment of a long literal, not a mention of the name. `PLAID_SECRET` as a
// Deno.env.get key is correct and everywhere; PLAID_SECRET = "abc123..." is the
// incident. Split-string construction keeps this scanner from matching itself.
const SECRET_PATTERNS = [
  {
    label: "private key block",
    re: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/,
  },
  {
    label: "Stripe secret/restricted key",
    re: new RegExp("\\b(?:s" + "k|r" + "k)_(?:live|test)_[A-Za-z0-9]{16,}"),
  },
  {
    label: "Supabase personal access token",
    re: new RegExp("\\bs" + "bp_[a-f0-9]{40,}"),
  },
  {
    label: "Plaid access token",
    re: new RegExp(
      "\\ba" + "ccess-(?:sandbox|development|production)-[0-9a-f-]{20,}",
    ),
  },
  {
    label: "JWT (service-role or anon key pasted as a literal)",
    re: /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    label: "secret assigned to a literal",
    re: /\b(?:SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|PLAID_SECRET|PLAID_CLIENT_ID|PLAID_ENCRYPTION_KEY|GOOGLE_SA_PRIVATE_KEY|SUPABASE_ACCESS_TOKEN)\s*[:=]\s*["'][^"'\n]{12,}["']/,
  },
];

// Vite exposes these to the client by design; anything else read off
// import.meta.env in src/ is either a typo or a secret about to ship.
const VITE_BUILTINS = new Set(["MODE", "BASE_URL", "PROD", "DEV", "SSR"]);

const isText = (p) =>
  !/\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf)$/i.test(p);
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const lineOf = (body, index) => body.slice(0, index).split("\n").length;

// ── checks ───────────────────────────────────────────────────────────────────

/** The build gate, without the bundling half. */
async function checkTypes(files, dir) {
  // tsconfig.app.json covers src/ only, so a Deno edge function changing is not
  // a reason to spend 14 seconds re-checking the frontend.
  if (!files.some((f) => f.startsWith("src/") && /\.(ts|tsx)$/.test(f)))
    return null;
  try {
    await run("npx tsc --noEmit -p tsconfig.app.json", {
      cwd: dir,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { name: "typecheck", errors: [] };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    const lines = out.split("\n").filter((l) => /error TS\d+/.test(l));
    return {
      name: "typecheck",
      errors: lines.length ? lines.slice(0, 15) : [out.slice(0, 1500)],
    };
  }
}

/** Lint only what changed — the repo's existing backlog is not this turn's problem. */
async function checkLint(files, dir) {
  const targets = files.filter(
    (f) => /\.(ts|tsx)$/.test(f) && f.startsWith("src/"),
  );
  if (!targets.length) return null;
  let stdout = "";
  try {
    ({ stdout } = await run(
      `npx eslint --format json ${targets.map(q).join(" ")}`,
      { cwd: dir, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (e) {
    stdout = e.stdout || "";
    if (!stdout.trim().startsWith("["))
      return {
        name: "eslint",
        warnings: [`could not run: ${(e.stderr || e.message).slice(0, 300)}`],
        errors: [],
      };
  }
  let report = [];
  try {
    report = JSON.parse(stdout);
  } catch {
    return { name: "eslint", errors: [], warnings: ["unparseable output"] };
  }
  const errors = [];
  const warnings = [];
  for (const file of report) {
    const rel = relative(dir, file.filePath).replace(/\\/g, "/");
    for (const m of file.messages) {
      const at = `${rel}:${m.line}  ${m.message} (${m.ruleId || "syntax"})`;
      (m.severity === 2 ? errors : warnings).push(at);
    }
  }
  return {
    name: "eslint",
    errors: errors.slice(0, 15),
    warnings: warnings.slice(0, 10),
  };
}

/** Nothing that looks like a credential may sit in a file we just wrote. */
function checkSecrets(files, dir) {
  const errors = [];
  // settings.json rides along on every run: it is committed, it accumulates
  // approved command strings, and a command string is a very easy place to
  // paste a token without noticing.
  const scan = new Set([...files, ".claude/settings.json"]);
  for (const rel of scan) {
    if (rel.startsWith(".claude/hooks/")) continue; // this file holds the patterns
    if (!isText(rel)) continue;
    const body = read(join(dir, rel));
    if (body === null) continue;
    for (const { label, re } of SECRET_PATTERNS) {
      const hit = re.exec(body);
      if (hit) errors.push(`${rel}:${lineOf(body, hit.index)}  ${label}`);
    }
  }
  return errors.length ? { name: "secrets", errors } : null;
}

/** CLAUDE.md's database rules, as greps. */
function checkMigrations(files, dir) {
  const targets = files.filter(
    (f) => f.startsWith("supabase/migrations/") && f.endsWith(".sql"),
  );
  if (!targets.length) return null;
  const errors = [];
  const warnings = [];
  for (const rel of targets) {
    const body = read(join(dir, rel));
    if (body === null) continue;
    const name = rel.split("/").pop();
    // Blocking, not advisory, since 2026-08-31: a short version prefix that
    // collides with a 14-digit one on the same date breaks the CLI's pairing
    // of local files against remote history, and `db push` then refuses to
    // apply ANY migration until the history table is repaired by hand. This
    // was a warning for eighteen files and got ignored every time; the failure
    // it causes is a total deploy block, so it earns an error.
    if (!/^\d{14}_/.test(name))
      errors.push(
        `${rel}  filename must start with a 14-digit YYYYMMDDHHMMSS version. ` +
          `A shorter prefix blocks "supabase db push" entirely once a second ` +
          `migration lands on the same date — see CLAUDE.md, 2026-08-31.`,
      );
    else if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name))
      warnings.push(`${rel}  filename is not YYYYMMDDHHMMSS_snake_case.sql`);

    for (const m of body.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi,
    )) {
      const table = m[1];
      const rls = new RegExp(
        `ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i",
      );
      if (!rls.test(body))
        errors.push(
          `${rel}:${lineOf(body, m.index)}  table "${table}" created without ENABLE ROW LEVEL SECURITY`,
        );
    }

    for (const m of body.matchAll(/SECURITY\s+DEFINER/gi)) {
      const after = body.slice(m.index, m.index + 600);
      if (!/SET\s+search_path\s*=/i.test(after))
        errors.push(
          `${rel}:${lineOf(body, m.index)}  SECURITY DEFINER without SET search_path = public, pg_temp`,
        );
    }

    for (const m of body.matchAll(/\bSELECT\s+\*/gi))
      warnings.push(
        `${rel}:${lineOf(body, m.index)}  SELECT * — enumerate columns (PHI/PFI exposure on new columns)`,
      );
  }
  warnings.push(
    "migrations changed — run `npx supabase db reset --no-seed` before committing; this hook does not.",
  );
  return { name: "migrations", errors, warnings: warnings.slice(0, 12) };
}

/**
 * Read a declared security exemption for one rule.
 *
 * CLAUDE.md's checklist has always allowed "explicitly documented public
 * endpoints", but this hook could not read intent, so a correct
 * server-to-server function failed every time anyone touched it. A check that
 * cries wolf on a file that is right gets ignored, and then it is not
 * protecting anything.
 *
 * A comment alone is NOT enough to exempt a file. The marker must name a
 * compensating control, and that control must actually appear as a call in the
 * same file:
 *
 *   // SECURITY-EXEMPTION(user-jwt): verifyPlaidWebhook
 *   // SECURITY-EXEMPTION(cors): server-to-server
 *
 * So the escape hatch cannot be used to wave a rule away -- it can only be
 * used to point at the thing standing in for it, and the pointer is checked.
 * `server-to-server` is the one accepted control for `cors`, because a
 * non-browser caller has no origin to whitelist and adding CORS to a webhook
 * would only widen it.
 */
function exemption(body, rule) {
  const m = new RegExp(
    `SECURITY-EXEMPTION\\(${rule}\\)\\s*:\\s*([A-Za-z0-9_.-]+)`,
  ).exec(body);
  if (!m) return null;
  const control = m[1];
  if (rule === "cors" && control === "server-to-server") return control;
  // Must be called, not merely mentioned in the comment that claims it.
  const called = new RegExp(`${control}\\s*\\(`).test(
    body.replace(/SECURITY-EXEMPTION\([^)]*\)\s*:\s*[A-Za-z0-9_.-]+/g, ""),
  );
  return called ? control : null;
}

/** The edge-function security checklist, as greps. */
function checkEdgeFunctions(files, dir) {
  const targets = files.filter(
    (f) =>
      f.startsWith("supabase/functions/") &&
      f.endsWith("/index.ts") &&
      !f.includes("/_shared/"),
  );
  if (!targets.length) return null;
  const errors = [];
  const warnings = [];
  for (const rel of targets) {
    const body = read(join(dir, rel));
    if (body === null) continue;

    // Never exemptible. A wildcard origin is wrong on every endpoint, and a
    // server-to-server function has no reason to send one at all.
    if (/["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/.test(body))
      errors.push(
        `${rel}  wildcard CORS — use getCorsHeaders(req.headers.get('origin'))`,
      );

    const corsExempt = exemption(body, "cors");
    if (!/getCorsHeaders/.test(body) && !corsExempt)
      errors.push(
        `${rel}  no getCorsHeaders — CORS origin must come from the whitelist,` +
          ` or declare // SECURITY-EXEMPTION(cors): server-to-server`,
      );
    else if (corsExempt) warnings.push(`${rel}  CORS exempt: ${corsExempt}`);

    const jwtExempt = exemption(body, "user-jwt");
    if (!/auth\.getUser\s*\(/.test(body) && !jwtExempt)
      errors.push(
        `${rel}  no supabase.auth.getUser() — authenticate, or declare` +
          ` // SECURITY-EXEMPTION(user-jwt): <the control that replaces it>`,
      );
    else if (jwtExempt)
      warnings.push(`${rel}  user-JWT exempt, verified by: ${jwtExempt}()`);
  }
  return { name: "edge functions", errors, warnings };
}

/** No secrets in src/, and only VITE_* off import.meta.env. */
function checkFrontendEnv(files, dir) {
  const targets = files.filter(
    (f) => f.startsWith("src/") && /\.(ts|tsx)$/.test(f),
  );
  if (!targets.length) return null;
  const errors = [];
  for (const rel of targets) {
    const body = read(join(dir, rel));
    if (body === null) continue;
    for (const m of body.matchAll(
      /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    )) {
      const key = m[1];
      if (!key.startsWith("VITE_") && !VITE_BUILTINS.has(key))
        errors.push(
          `${rel}:${lineOf(body, m.index)}  import.meta.env.${key} — only VITE_* is safe to ship to the browser`,
        );
    }
  }
  return errors.length ? { name: "frontend env", errors } : null;
}

/**
 * The mileage rate table must stay contiguous.
 *
 * A gap means medicalMileageAmount() refuses to price a trip and the user
 * cannot log driving at all; an overlap means the first matching period wins
 * silently and the rate applied depends on array order. Both have happened in
 * spirit: the 2026 rate was entered as one full-year period when Announcement
 * 2026-11 had already split the year on July 1, which underpriced every trip
 * after that date by 3 cents a mile.
 */
function checkMileageRates(files, dir) {
  const rel = "src/lib/regulatoryLimits.ts";
  if (!files.includes(rel)) return null;
  const body = read(join(dir, rel));
  if (body === null) return null;
  const start = body.indexOf("MEDICAL_MILEAGE_RATES");
  const block = body.slice(start, body.indexOf("] as const;", start));
  const re =
    /start:\s*"(\d{4}-\d{2}-\d{2})",\s*end:\s*"(\d{4}-\d{2}-\d{2})",\s*ratePerMile:\s*([0-9.]+),\s*confirmed:\s*(true|false)/g;
  const periods = [...block.matchAll(re)].map((m) => ({
    start: m[1],
    end: m[2],
    rate: +m[3],
    confirmed: m[4] === "true",
  }));
  const errors = [];
  const warnings = [];
  if (periods.length < 2)
    return {
      name: "mileage rates",
      errors: ["could not parse MEDICAL_MILEAGE_RATES"],
    };
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (p.start > p.end)
      errors.push(`period starting ${p.start} ends before it begins`);
    if (i > 0) {
      const prev = periods[i - 1];
      const next = new Date(Date.parse(prev.end + "T00:00:00Z") + 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (next !== p.start)
        errors.push(
          next < p.start
            ? `gap: nothing covers ${next}..${p.start} — mileage entry refuses to price those dates`
            : `overlap: ${p.start} is still inside the period ending ${prev.end}`,
        );
    }
    if (!p.confirmed)
      warnings.push(
        `${p.start}..${p.end} at ${p.rate} is unconfirmed — verify against the IRS notice and set confirmed: true`,
      );
  }
  const thisYear = new Date().getUTCFullYear();
  if (!periods.some((p) => p.end >= `${thisYear}-12-31`))
    warnings.push(
      `no period covers the end of ${thisYear} — a missed January leaves users unable to log driving`,
    );
  return { name: "mileage rates", errors, warnings };
}

// ── driver ───────────────────────────────────────────────────────────────────

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    /* fall through to cwd */
  }

  const dir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const pendingPath = join(dir, ".claude", ".done-checks-pending");
  const statePath = join(dir, ".claude", ".done-checks-state.json");

  if (process.env.RECLAIM_SKIP_DONE_CHECKS === "1") return 0;
  if (existsSync(join(dir, ".claude", ".done-checks-off"))) return 0;
  if (!existsSync(pendingPath)) return 0;

  const files = [
    ...new Set(
      readFileSync(pendingPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((p) =>
          relative(dir, isAbsolute(p) ? p : resolve(dir, p)).replace(
            /\\/g,
            "/",
          ),
        )
        .filter((p) => p && !p.startsWith("..") && existsSync(join(dir, p))),
    ),
  ];
  if (!files.length) {
    rmSync(pendingPath, { force: true });
    return 0;
  }

  const results = (
    await Promise.all([
      checkTypes(files, dir),
      checkLint(files, dir),
      Promise.resolve(checkSecrets(files, dir)),
      Promise.resolve(checkMigrations(files, dir)),
      Promise.resolve(checkEdgeFunctions(files, dir)),
      Promise.resolve(checkFrontendEnv(files, dir)),
      Promise.resolve(checkMileageRates(files, dir)),
    ])
  ).filter(Boolean);

  const failed = results.filter((r) => r.errors?.length);
  const warned = results.filter((r) => r.warnings?.length);

  if (!failed.length) {
    rmSync(pendingPath, { force: true });
    rmSync(statePath, { force: true });
    const names = results.map((r) => r.name).join(", ") || "nothing to check";
    let out = `done-checks: ${files.length} file(s) — ${names} — clean`;
    for (const r of warned)
      out +=
        `\n  ${r.name} advisories:\n` +
        r.warnings.map((w) => `    · ${w}`).join("\n");
    console.log(out);
    return 0;
  }

  // Same batch failing repeatedly must not trap the session.
  let state = { key: "", blocks: 0 };
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    /* first failure */
  }
  const key = files.slice().sort().join("|");
  state =
    key === state.key ? { key, blocks: state.blocks + 1 } : { key, blocks: 1 };
  writeFileSync(statePath, JSON.stringify(state), "utf8");

  const report =
    `done-checks failed on ${files.length} file(s) changed this turn:\n\n` +
    failed
      .map((r) => `${r.name}:\n` + r.errors.map((e) => `  · ${e}`).join("\n"))
      .join("\n\n") +
    (warned.length
      ? "\n\nadvisory:\n" +
        warned.flatMap((r) => r.warnings.map((w) => `  · ${w}`)).join("\n")
      : "");

  if (state.blocks > MAX_BLOCKS) {
    rmSync(pendingPath, { force: true });
    rmSync(statePath, { force: true });
    console.log(
      `${report}\n\nStill failing after ${MAX_BLOCKS} attempts — not blocking again. ` +
        `These are unresolved and must be reported to the user, not passed over in silence.`,
    );
    return 0;
  }

  console.error(report);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // A broken hook must not become a broken session.
    console.log(`done-checks: hook error, skipped — ${err?.message ?? err}`);
    process.exit(0);
  });
