#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const CANONICAL_REGEX = /raroque\/kizuna-agent(\.git)?$/;
const FETCH_TIMEOUT_MS = 5000;

const C = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

function tryExec(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function isAncestor(ref) {
  try {
    execSync(`git merge-base --is-ancestor ${ref} HEAD`, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function fetchUpstream() {
  return new Promise((resolveFn) => {
    const child = spawn("git", ["fetch", "upstream", "main", "--quiet"], {
      cwd: root,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      resolveFn(false);
    }, FETCH_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveFn(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolveFn(false);
    });
  });
}

function printBehindBanner(ahead) {
  const pad = (s, n) => s + " ".repeat(Math.max(0, n - stripAnsi(s).length));
  const line = `📦  ${ahead} new commit${ahead === 1 ? "" : "s"} upstream on raroque/kizuna-agent`;
  const cmd = `${C.bold}/upgrade-kizuna${C.reset}${C.yellow}`;
  console.log(`
${C.yellow}╭──────────────────────────────────────────────────────────────╮
│ ${pad(line, 60)} │
│                                                              │
│ Open \`claude\` in this repo and run:                          │
│   ${pad(cmd, 58)} │
│                                                              │
│ Previews diffs, tags a rollback, merges, surfaces [BREAKING] │
│ entries in CHANGELOG.                                        │
╰──────────────────────────────────────────────────────────────╯${C.reset}
`);
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function printNoUpstreamHint() {
  console.log(
    `${C.dim}  ℹ Tip: set up upstream for new-version checks on \`npm run dev\`:
     ${C.bold}git remote add upstream https://github.com/raroque/kizuna-agent.git${C.reset}${C.dim}
     Then \`claude\` → \`/upgrade-kizuna\` whenever upstream has changes.${C.reset}
`,
  );
}
function readEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const envFromFile = readEnvLocal();
const upstreamCheckEnabled =
  (process.env.KIZUNA_UPSTREAM_CHECK ?? envFromFile.KIZUNA_UPSTREAM_CHECK ?? "true") !== "false";
if (!upstreamCheckEnabled) process.exit(0);

(async () => {
  const upstreamUrl = tryExec("git remote get-url upstream");

  if (!upstreamUrl) {
    const originUrl = tryExec("git remote get-url origin") || "";
    if (!CANONICAL_REGEX.test(originUrl)) {
      printNoUpstreamHint();
    }
    return;
  }

  const fetched = await fetchUpstream();
  if (!fetched) return;

  const upstreamHead = tryExec("git rev-parse upstream/main");
  if (!upstreamHead) return;

  if (isAncestor(upstreamHead)) return;

  const ahead = parseInt(tryExec(`git rev-list --count HEAD..${upstreamHead}`) || "0", 10);
  if (!ahead) return;
  printBehindBanner(ahead);
})().catch(() => {
});
