import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { handleUserMessage } from "./interaction-agent.js";
import { sendTelegram } from "./channel-send.js";
import { broadcast } from "./broadcast.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { is_bot?: boolean };
  };
};

let polling = false;
let offset = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const anyErr = err as Error & {
    code?: string;
    cause?: { code?: string; errno?: string };
  };
  const code = anyErr.code ?? anyErr.cause?.code ?? anyErr.cause?.errno;

  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_SOCKET" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  );
}

async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: T;
        description?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.description ?? `Telegram API ${method} failed (${res.status})`);
      }
      return json.result as T;
    } catch (err) {
      lastError = err;
      if (!isTransientNetworkError(err) || attempt === 2) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const content = message?.text?.trim();
  const chatId = message?.chat?.id?.toString();
  if (!content || !chatId || message?.from?.is_bot) return;

  const conversationId = `telegram:${chatId}`;
  const turnTag = Math.random().toString(36).slice(2, 8);
  const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
  console.log(`[telegram ${turnTag}] ← ${chatId}: ${JSON.stringify(preview)}`);
  broadcast("message_in", { conversationId, content, channel: "telegram" });

  try {
    const reply = await handleUserMessage({ conversationId, content, turnTag });
    if (reply) {
      await sendTelegram(chatId, reply);
      await convex.mutation(api.messages.send, { conversationId, role: "assistant", content: reply });
    }
  } catch (err) {
    console.error(`[telegram ${turnTag}] handler error`, err);
  }
}

async function skipBacklog(): Promise<void> {
  const updates = await telegramApi<TelegramUpdate[]>("getUpdates", { timeout: 0, limit: 100 });
  if (updates.length > 0) {
    offset = Math.max(...updates.map((u) => u.update_id)) + 1;
    console.log(`[telegram] skipped ${updates.length} old update(s)`);
  }
}

export async function startTelegramPolling(): Promise<void> {
  if (polling) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[telegram] polling disabled — TELEGRAM_BOT_TOKEN not set");
    return;
  }

  polling = true;
  console.log("[telegram] polling enabled");

  await skipBacklog().catch((err) => console.warn("[telegram] couldn't skip backlog", err));

  while (polling) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await processUpdate(update);
      }
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn("[telegram] polling transport reset; retrying");
      } else {
        console.error("[telegram] polling error", err);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export function stopTelegramPolling(): void {
  polling = false;
}
