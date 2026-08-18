#!/usr/bin/env node
/**
 * PostToolUse hook (Write|Edit) — format the file, then remember it.
 *
 * Two jobs, one process, because spawning node twice per edit is the whole
 * cost of this hook.
 *
 *  1. Run prettier on the file that was just written.
 *  2. Append its path to .claude/.done-checks-pending, which done-checks.mjs
 *     reads at the end of the turn to decide what to verify.
 *
 * WHY THIS IS A SCRIPT AND NOT AN INLINE COMMAND. It replaces
 *   npx prettier --write "$CLAUDE_FILE_PATH" 2>/dev/null || true
 * which does work today — verified, not assumed — but rests on two things
 * that are not contracts. CLAUDE_FILE_PATH is not in the documented hook
 * environment (only CLAUDE_PROJECT_DIR and friends are); the documented input
 * is tool_input.file_path on stdin, which is what this reads. And the inline
 * form assumes a POSIX shell for `2>/dev/null || true`, which is not a safe
 * assumption on the Windows box this repo is developed on. Folding the
 * recorder in here also means one process per edit rather than two.
 *
 * This hook must never fail the tool call. Any error exits 0 quietly: a
 * formatter or a bookkeeping file is not worth interrupting real work over.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, isAbsolute, resolve } from "node:path";

const PRETTIER_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|md|html|yml|yaml)$/i;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function main(payload) {
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) return;

  const abs = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
  if (!existsSync(abs)) return; // deleted, or a tool that reports paths differently

  // 1. Format. Prettier owns style so the checks below never argue about it.
  if (PRETTIER_EXT.test(abs)) {
    spawnSync("npx", ["prettier", "--write", `"${abs}"`], {
      cwd: projectDir,
      shell: true,
      stdio: "ignore",
      timeout: 30_000,
    });
  }

  // 2. Record. One path per line; done-checks.mjs dedupes and clears it.
  const pending = join(projectDir, ".claude", ".done-checks-pending");
  mkdirSync(dirname(pending), { recursive: true });
  appendFileSync(pending, abs + "\n", "utf8");
}

readStdin()
  .then((raw) => {
    try {
      main(JSON.parse(raw || "{}"));
    } catch {
      /* never block a tool call over bookkeeping */
    }
    process.exit(0);
  })
  .catch(() => process.exit(0));
