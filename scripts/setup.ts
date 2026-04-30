#!/usr/bin/env tsx
import prompts from "prompts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(path: string, env: Record<string, string>): void {
  const example = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, "utf8") : "";

  let out = "";
  const seen = new Set<string>();
  const sections = example.split(/\n(?=# ----)/);

  for (const section of sections) {
    const sectionKeys = [...section.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    let s = section;
    for (const k of sectionKeys) {
      const pattern = new RegExp(`^${k}=.*(\\r?\\n)?`, "gm");
      const matches = [...s.matchAll(pattern)];
      if (matches.length === 0) continue;

      if (seen.has(k)) {
        s = s.replace(pattern, "");
        continue;
      }

      const v = env[k] ?? "";
      let replaced = false;
      s = s.replace(pattern, (match) => {
        if (!replaced) {
          replaced = true;
          return `${k}=${v}` + (match.endsWith("\n") ? "\n" : "");
        }
        return "";
      });
      seen.add(k);
    }
    out += s + "\n";
  }
  writeFileSync(path, out.trim() + "\n");
}

function cleanConvexUrlEnv(path: string): void {
  const envContent = readFileSync(path, "utf8");
  const updated = envContent.replace(/^VITE_CONVEX_URL=.*(\r?\n)?/gm, "");
  writeFileSync(path, updated);
}

function banner(s: string) {
  console.log("\n" + "━".repeat(60));
  console.log("  " + s);
  console.log("━".repeat(60));
}

async function runConvexDev(): Promise<void> {
  const existing = readEnv(ENV_PATH);
  const args = existing.CONVEX_DEPLOYMENT
    ? ["convex", "dev", "--once"]
    : ["convex", "dev", "--once", "--configure", "new"];

  if (!existing.CONVEX_DEPLOYMENT) {
    cleanConvexUrlEnv(ENV_PATH);
  }

  console.log(
    `\nLaunching \`npx ${args.join(" ")}\` to configure your deployment.`,
  );
  console.log("Convex will open a browser window if you're not logged in.");
  if (existing.CONVEX_DEPLOYMENT) {
    console.log(`Reusing existing deployment: ${existing.CONVEX_DEPLOYMENT}`);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("npx", args, { stdio: "inherit", cwd: ROOT });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`convex dev exited ${code}`)),
    );
  });
}

function hasBinary(name: string): Promise<boolean> {
  return new Promise((ok) => {
    const lookup = process.platform === "win32" ? "where" : "which";
    const child = spawn(lookup, [name], { stdio: "ignore" });
    child.on("exit", (code) => ok(code === 0));
    child.on("error", () => ok(false));
  });
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
  }
}

async function main() {
  banner("Kizuna Agent setup (Codex + Telegram)");

  console.log(`
What this does:
  1. Configures Telegram polling (no webhook or public tunnel required)
  2. Asks about your Codex model preference
  3. Runs ` + "`npx convex dev`" + ` to create/configure a Convex project
  4. Writes .env.local

Before you start:
  • Codex CLI signed in:           run ` + "`codex`" + ` once and sign in
  • Telegram bot token:            create one with BotFather
  • Convex account (free tier):    https://convex.dev
`);

  const existing = readEnv(ENV_PATH);

  const answers = await prompts(
    [
      {
        type: existing.TELEGRAM_BOT_TOKEN ? "confirm" : null,
        name: "replaceTelegramToken",
        message: "Telegram bot token detected. Replace it?",
        initial: false,
      },
      {
        type: (_prev: boolean, values: any) =>
          !existing.TELEGRAM_BOT_TOKEN || values.replaceTelegramToken ? "password" : null,
        name: "TELEGRAM_BOT_TOKEN",
        message: "Telegram bot token from BotFather",
        initial: "",
      },
      {
        type: "select",
        name: "KIZUNA_MODEL",
        message: "Which Codex model should the agent use?",
        choices: [
          { title: "auto (recommended for Codex subscription)", value: "auto" },
          { title: "gpt-5 (general purpose, if available)", value: "gpt-5" },
          { title: "gpt-4.1 (fast fallback, if available)", value: "gpt-4.1" },
        ],
        initial: 0,
      },
      {
        type: "text",
        name: "PORT",
        message: "Local server port",
        initial: existing.PORT ?? "3456",
      },
      {
        type: "confirm",
        name: "runConvex",
        message: "Run `npx convex dev --once` now to configure your Convex deployment and generate types?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (!answers.TELEGRAM_BOT_TOKEN && existing.TELEGRAM_BOT_TOKEN && !answers.replaceTelegramToken) {
    answers.TELEGRAM_BOT_TOKEN = existing.TELEGRAM_BOT_TOKEN;
  }
  banner("Composio — integrations (Gmail, GitHub, Linear, Notion, 1000+ more)");
  const composioSettingsUrl = "https://platform.composio.dev/settings";
  const existingComposio = existing.COMPOSIO_API_KEY ?? "";
  const { composioMode } = await prompts(
    {
      type: "select",
      name: "composioMode",
      message: existingComposio
        ? "Composio API key detected. Keep it or replace?"
        : "Configure Composio now? (needed to connect integrations)",
      choices: existingComposio
        ? [
            { title: "Keep existing key", value: "keep" },
            { title: "Replace (opens the Composio dashboard)", value: "replace" },
            { title: "Skip", value: "skip" },
          ]
        : [
            { title: "Yes — open the Composio dashboard and paste my key", value: "replace" },
            { title: "Skip for now", value: "skip" },
          ],
      initial: 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (composioMode === "replace") {
    console.log(`\nOpening ${composioSettingsUrl} — grab your API key there.`);
    console.log(`(If the browser doesn't open, copy the URL above.)\n`);
    openInBrowser(composioSettingsUrl);
    const { COMPOSIO_API_KEY } = await prompts(
      {
        type: "password",
        name: "COMPOSIO_API_KEY",
        message: "Paste your Composio API key (leave blank to skip):",
        initial: "",
      },
      {
        onCancel: () => {
          console.log("Setup cancelled.");
          process.exit(1);
        },
      },
    );
    (answers as any).COMPOSIO_API_KEY = COMPOSIO_API_KEY || existingComposio;
  } else if (composioMode === "keep") {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
  } else {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
    console.log(`\nSkipped. Add COMPOSIO_API_KEY to .env.local later to enable integrations.`);
  }

  const env: Record<string, string> = { ...existing, ...answers };
  delete (env as any).runConvex;
  delete (env as any).replaceTelegramToken;
  if (!env.PUBLIC_URL) env.PUBLIC_URL = `http://localhost:${env.PORT ?? "3456"}`;
  if (env.CONVEX_URL?.includes("example.convex.cloud")) delete env.CONVEX_URL;
  if (env.VITE_CONVEX_URL?.includes("example.convex.cloud")) delete env.VITE_CONVEX_URL;
  writeEnv(ENV_PATH, env);

  banner("Codex authentication");
  const codexInstalled = await hasBinary("codex");
  console.log(`This project is configured for Codex instead of Claude Code.

If you haven't already:
  • Install Codex CLI:  npm install -g @openai/codex
  • Run once:           codex
  • Sign in when prompted

No OpenAI API key is required when you're signed in through Codex.
Codex installed on PATH: ${codexInstalled ? "yes" : "no"}
`);

  if (answers.runConvex) {
    await runConvexDev();
    const after = readEnv(ENV_PATH);
    const deploymentMatch = after.CONVEX_DEPLOYMENT?.match(/^([a-z]+):([\w-]+)/);

    const url = after.CONVEX_URL || after.VITE_CONVEX_URL || (deploymentMatch ? `https://${deploymentMatch[2]}.convex.cloud` : "");
    if (url && (after.CONVEX_URL !== url || after.VITE_CONVEX_URL !== url)) {
      writeEnv(ENV_PATH, {
        ...after,
        CONVEX_URL: url,
        VITE_CONVEX_URL: url,
      });
      console.log(`\n✓ Synced CONVEX_URL + VITE_CONVEX_URL → ${url}`);
    }
  } else {
    console.log("\nSkipped Convex. Run `npx convex dev --once` yourself when ready.");
  }

  banner("You're set up. Here's how to run it.");
  console.log(`
Run one command:

  bun run dev

That starts the server, Convex watcher, debug dashboard, and Telegram polling.

Telegram:
  • Make sure TELEGRAM_BOT_TOKEN is set in .env.local.
  • Message your bot in Telegram.
  • No ngrok, webhook, or public URL is required.

Dashboard:
  • Open http://localhost:5173
  • Use the Chat tab for local testing.

Integrations (via Composio):
  1. Set COMPOSIO_API_KEY in .env.local.
  2. Open dashboard → Connections tab.
  3. Connect toolkits like Gmail, GitHub, Linear, Notion, etc.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
