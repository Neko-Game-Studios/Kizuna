import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { kizunaUserId } from "./composio-data.js";

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;
type CodexConfigObject = { [key: string]: CodexConfigValue };

const serverDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(serverDir, "..");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const coreServer = resolve(serverDir, "kizuna-core-mcp.ts");
const composioServer = resolve(serverDir, "composio-mcp.ts");

function stdioServer(script: string, env: Record<string, string>): CodexConfigObject {
  return {
    command: tsxBin,
    args: [script],
    env,
  };
}

export function buildInteractionCodexConfig(conversationId: string): CodexConfigObject {
  const env: Record<string, string> = {
    KIZUNA_CONVERSATION_ID: conversationId,
  };
  if (process.env.COMPOSIO_API_KEY) {
    env.COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
    env.COMPOSIO_USER_ID = kizunaUserId();
  }
  return {
    mcp_servers: {
      "kizuna-core": stdioServer(coreServer, env),
    },
  };
}

export function buildExecutionCodexConfig(opts: {
  conversationId?: string;
  integrations: string[];
}): CodexConfigObject {
  const servers: Record<string, CodexConfigObject> = {};
  if (opts.conversationId) {
    const env: Record<string, string> = {
      KIZUNA_CONVERSATION_ID: opts.conversationId,
    };
    if (process.env.COMPOSIO_API_KEY) {
      env.COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
      env.COMPOSIO_USER_ID = kizunaUserId();
    }
    servers["kizuna-core"] = stdioServer(coreServer, env);
  }
  if (process.env.COMPOSIO_API_KEY) {
    servers["composio"] = stdioServer(composioServer, {
      COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
      COMPOSIO_USER_ID: kizunaUserId(),
      KIZUNA_ALLOWED_TOOLKITS: opts.integrations.join(","),
    });
  }
  return { mcp_servers: servers };
}
