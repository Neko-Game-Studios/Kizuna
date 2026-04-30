import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { extractAndStore } from "./memory/extract.js";
import { spawnExecutionAgent } from "./execution-agent.js";
import { getRuntimeModel } from "./runtime-config.js";
import { broadcast } from "./broadcast.js";
import { sendToConversation } from "./channel-send.js";
import { EMPTY_USAGE, type UsageTotals } from "./usage.js";
import { askCodex } from "./codex-agent.js";
import { listConnectedToolkits, listToolkitMeta, listToolsForToolkit } from "./composio-data.js";
import { buildInteractionCodexConfig } from "./codex-mcp-config.js";

const INTERACTION_SYSTEM = `You are Kizuna Agent, a personal agent the user can message from chat or Telegram.

You are a DISPATCHER, not a doer. Your job:
1. Understand what the user wants.
2. Decide: answer directly (quick facts, chit-chat, anything you already know) OR spawn_agent (real work that needs tools like email, calendar, web, etc.).
3. When you spawn, give the agent a crisp, specific task — not the raw user message.
4. When the agent returns, relay the result in YOUR voice, tightened for chat.

Tone: Warm, witty, concise. Write like you're texting a friend. No corporate voice. No bullet dumps unless the user asked for a list.

Your only tools:
- recall / write_memory (durable memory for this user)
- spawn_agent (dispatches a sub-agent that CAN touch the world)
- create_automation / list_automations / toggle_automation / delete_automation
- list_drafts / send_draft / reject_draft
- get_config / set_model / list_integrations / search_composio_catalog / inspect_toolkit (self-inspection)

You cannot answer factual questions from your own knowledge. Not allowed.
You have NO browser, NO WebSearch, NO WebFetch, NO file access, NO APIs.
You are not allowed to recite facts about places, events, people, prices,
news, URLs, statistics, or anything "in the world." Your training data does
not count as a source.

Hard rule: if the user asks for information, research, a lookup, a
recommendation that requires real-world data, a current event, a comparison,
a tutorial, a how-to, any URL, or anything you'd be tempted to "just know" —
spawn_agent. No exceptions. Even if you're 99% sure. The sub-agent has
WebSearch/WebFetch and will return real citations; you don't and won't.

Acknowledgment rule (messaging UX):
BEFORE every spawn_agent call, you MUST call send_ack first with a short
1-sentence message. The user otherwise sees nothing for 10-30 seconds while
the sub-agent works. Examples of good acks:
  "On it — one sec 🔍"
  "Looking into your calendar…"
  "Drafting that email now."
  "Checking that now, hold tight."
Order: send_ack → spawn_agent → (wait) → final reply with the result.
Skip the ack ONLY for things you'll answer in under 2 seconds (chit-chat,
simple memory recall, single automation toggle).

Memory:
- Call recall() early for anything that might touch the user's preferences, projects, or history.
- Call write_memory() aggressively for durable facts. Err on the side of saving.

Safe to answer directly (no spawn needed):
- Greetings, acknowledgments, short conversational turns ("thanks", "lol", "ok got it").
- Explaining what you just did, confirming a draft, relaying a sub-agent's result.
- Clarifying your own abilities ("yes I can do that", "I'll need your X to proceed").
- Anything that's purely about the user (using recall).

Everything else — SPAWN.

Never fabricate URLs, site names, "sources", statistics, news, quotes, prices,
dates, or any external fact. "Sources: [vague site names]" is fabrication.

When relaying a sub-agent's answer:
- Pass through the Sources section the sub-agent included, VERBATIM. Don't
  add, remove, paraphrase, or summarize URLs.
- If the sub-agent did NOT include a Sources section, YOU DO NOT ADD ONE.
  Do not write "Sources: Lonely Planet, etc." No exceptions.
- You may tighten the body for chat (shorter bullets, fewer emojis),
  but the URLs are ground truth — don't touch them.

Automations:
- When the user asks for anything recurring ("every morning", "each week", "remind me", "check X daily"), use create_automation — don't just promise to do it later.
- Pick a cron expression (5 fields) and a specific task for the sub-agent.
- If they ask "what have I set up" or want to change/cancel something, use list_automations / toggle_automation / delete_automation.

Drafts:
- Any external action (email, calendar event, message in an integration) goes through the draft flow. Execution agents SAVE drafts rather than sending directly.
- When the user confirms ("send it", "yes", "go ahead"), call list_drafts then send_draft with the matching integrations.
- When the user cancels or revises, call reject_draft.
- Never claim something was sent unless send_draft returned success.

Integration capabilities — IMPORTANT:
You only know integration NAMES, not their actual tool surface. Composio's
toolkits don't always expose the tools you'd expect from the brand (e.g. the
LinkedIn toolkit has no inbox/DM tools). If the user asks what you can do
with a specific integration, spawn_agent against it — the sub-agent has
COMPOSIO_SEARCH_TOOLS and will return the real tool list. Never describe
integration capabilities from training-data knowledge of the product.

Self-inspection (no spawn needed — answer instantly):
- "What model are you running?" → get_config
- "Use codex" / "switch to gpt-5" / "make it faster" → set_model (takes effect next turn; this turn finishes on the current model)
- "What integrations / accounts are connected?" / "Which Gmail account?" → list_integrations
- "Is there a tool for X?" / "Can you connect to Y?" → search_composio_catalog
- "Is Gmail connected?" / "What tools does Notion expose?" → inspect_toolkit (set includeTools=true if they want the tool list)
Use these tools when the user asks about Kizuna's own configuration, connected
accounts, or whether a service is reachable. They're cheap and synchronous —
no ack required.

Available integrations for spawn_agent: {{INTEGRATIONS}}

Format: Plain chat-friendly text. Markdown sparingly. Keep replies under ~400 chars when you can.`;

interface HandleOpts {
  conversationId: string;
  content: string;
  turnTag?: string;
  onThinking?: (chunk: string) => void;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}

function extractToolkitName(content: string): string | null {
  const patterns = [
    /(?:is|was|are|do i have)\s+([a-z0-9._ -]+?)\s+connected\b/i,
    /what tools does\s+([a-z0-9._ -]+?)\s+expose\b/i,
    /which\s+([a-z0-9._ -]+?)\s+account\b/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function wantsGmailLatestMail(content: string): boolean {
  return (
    /(?:latest|newest|most recent|recent|last)\s+(?:gmail\s+)?(?:mail|email|message|inbox)/i.test(content) ||
    (/\bgmail\b/i.test(content) &&
      /(?:pull up|check|fetch|show|get|read|open|latest|newest|recent|inbox|mail|email|message)/i.test(content))
  );
}

async function handleSelfInspection(content: string): Promise<string | null> {
  const lower = content.toLowerCase();
  const connected = await listConnectedToolkits();

  if (/(what integrations|which integrations|what tools do i have connected|what accounts are connected)/i.test(content)) {
    if (connected.length === 0) {
      return "No integrations are connected yet.";
    }
    const lines = connected.map((toolkit) => {
      const label = toolkit.accountLabel ?? toolkit.accountEmail ?? toolkit.alias ?? "(unknown)";
      const status = toolkit.status === "ACTIVE" ? "connected" : toolkit.status.toLowerCase();
      return `• ${toolkit.slug} — ${status}${label ? ` — ${label}` : ""}`;
    });
    return `Connected integrations:\n${lines.join("\n")}`;
  }

  if (/what model are you|which model|what codex model|what version are you/i.test(content)) {
    const { getRuntimeModel } = await import("./runtime-config.js");
    return `I'm using ${await getRuntimeModel()}.`;
  }

  const toolkitName = extractToolkitName(content);
  if (!toolkitName) return null;

  const normalized = normalizeName(toolkitName);
  const matched = connected.find((toolkit) => normalizeName(toolkit.slug).includes(normalized));

  if (/what tools does .* expose/i.test(lower)) {
    const meta = await listToolkitMeta();
    const toolkit = matched ?? connected.find((t) => normalizeName(t.slug) === normalized);
    if (!toolkit) {
      return `I don't see ${toolkitName} connected yet.`;
    }
    const tools = await listToolsForToolkit(toolkit.slug);
    const name = meta.get(toolkit.slug)?.name ?? toolkit.slug;
    if (tools.length === 0) {
      return `${name} is connected, but I couldn't load its tool list right now.`;
    }
    const listed = tools.slice(0, 12).map((tool) => `• ${tool.name ?? tool.slug}`).join("\n");
    return `${name} is connected.\nTools:\n${listed}${tools.length > 12 ? "\n• …" : ""}`;
  }

  if (/connected\b/i.test(content)) {
    if (matched) {
      const label = matched.accountLabel ?? matched.accountEmail ?? matched.alias ?? "(unknown)";
      return `${matched.slug} is connected${label ? ` as ${label}` : ""}.`;
    }
    return `${toolkitName} isn't connected yet.`;
  }

  if (/which .* account/i.test(lower) && matched) {
    const label = matched.accountLabel ?? matched.accountEmail ?? matched.alias ?? "(unknown)";
    return `${matched.slug} is connected as ${label}.`;
  }

  return null;
}

export async function handleUserMessage(opts: HandleOpts): Promise<string> {
  const turnId = randomId("turn");
  // Refresh the connected toolkit list so newly connected accounts are visible on this turn.
  const connectedToolkits = await listConnectedToolkits();
  const integrations = connectedToolkits.map((toolkit) => toolkit.slug);

  await convex.mutation(api.messages.send, {
    conversationId: opts.conversationId,
    role: "user",
    content: opts.content,
    turnId,
  });
  broadcast("user_message", { conversationId: opts.conversationId, content: opts.content });

  const history = await convex.query(api.messages.recent, {
    conversationId: opts.conversationId,
    limit: 10,
  });
  const historyBlock = history
    .slice(0, -1)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const systemPrompt = INTERACTION_SYSTEM.replace(
    "{{INTEGRATIONS}}",
    integrations.join(", ") || "(no integrations configured yet)",
  );

  const prompt = historyBlock
    ? `Prior turns:\n${historyBlock}\n\nCurrent message:\n${opts.content}`
    : opts.content;

  const tag = opts.turnTag ?? turnId.slice(-6);
  const log = (msg: string) => console.log(`[turn ${tag}] ${msg}`);

  const turnStart = Date.now();
  const requestedModel = await getRuntimeModel();
  let reply = "";
  let usage: UsageTotals = { ...EMPTY_USAGE };
  try {
    if (wantsGmailLatestMail(opts.content)) {
      const ack = "Checking your latest Gmail now.";
      await sendToConversation(opts.conversationId, ack);
      await convex.mutation(api.messages.send, {
        conversationId: opts.conversationId,
        role: "assistant",
        content: ack,
        turnId,
      });
      broadcast("assistant_ack", { conversationId: opts.conversationId, content: ack });
      const res = await spawnExecutionAgent({
        conversationId: opts.conversationId,
        integrations,
        name: "gmail-latest-mail",
        task:
          "Pull the user's newest email from Gmail. Return sender, subject, timestamp, and a short snippet. If Gmail is unavailable, say so plainly. Do not invent a connection status. Use the connected default Gmail account unless the user specified a particular one.",
      });
      reply = res.result;
      usage = { ...EMPTY_USAGE, model: requestedModel };
    } else {
      const selfReply = await handleSelfInspection(opts.content);
      if (selfReply) {
        reply = selfReply;
        usage = { ...EMPTY_USAGE, model: requestedModel };
      } else {
        const codexResult = await askCodex(prompt, systemPrompt, requestedModel, {
          codexConfig: buildInteractionCodexConfig(opts.conversationId),
        });
        reply = codexResult.text;
        usage = {
          ...EMPTY_USAGE,
          model: requestedModel,
          inputTokens: codexResult.inputTokens,
          outputTokens: codexResult.outputTokens,
        };
      }
    }
  } catch (err) {
    console.error(`[turn ${tag}] codex failed`, err);
    reply = "Sorry — I hit an error processing that. Try again in a moment.";
  }

  reply = reply.trim() || "(no reply)";

  if (usage.costUsd > 0 || usage.inputTokens > 0) {
    log(
      `cost: in/out ${usage.inputTokens}/${usage.outputTokens}, cache r/w ${usage.cacheReadTokens}/${usage.cacheCreationTokens}, $${usage.costUsd.toFixed(4)}`,
    );
    await convex.mutation(api.usageRecords.record, {
      source: "dispatcher",
      conversationId: opts.conversationId,
      turnId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd: usage.costUsd,
      durationMs: Date.now() - turnStart,
    });
  }

  broadcast("assistant_message", { conversationId: opts.conversationId, content: reply });
  extractAndStore({
    conversationId: opts.conversationId,
    userMessage: opts.content,
    assistantReply: reply,
    turnId,
  }).catch((err) => console.error("[interaction] extraction error", err));

  return reply;
}
