import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { broadcast } from "./broadcast.js";
import { sendToConversation } from "./channel-send.js";
import { spawnExecutionAgent } from "./execution-agent.js";
import { getRuntimeModel, resolveModelInput, setRuntimeModel, KNOWN_MODELS, MODEL_ALIASES } from "./runtime-config.js";
import {
  listConnectedToolkits,
  listToolkitMeta,
  listToolsForToolkit,
} from "./composio-data.js";
import { embed, embeddingsAvailable } from "./embeddings.js";
import { DEFAULT_DECAY, SEGMENT_PREFERRED_TIER, makeMemoryId } from "./memory/types.js";
import { validateSchedule, nextRunFor } from "./automations.js";

const conversationId = process.env.KIZUNA_CONVERSATION_ID;

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "kizuna-core",
    version: "0.1.0",
  });

  server.registerTool(
    "send_ack",
    {
      description: "Send a short acknowledgment message to the conversation.",
      inputSchema: z.object({ message: z.string() }),
    },
    async ({ message }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const text = message.trim();
      if (!text) {
        return { content: [{ type: "text", text: "Empty ack skipped." }] };
      }
      await sendToConversation(conversationId, text);
      await convex.mutation(api.messages.send, {
        conversationId,
        role: "assistant",
        content: text,
        turnId: randomId("turn"),
      });
      broadcast("assistant_ack", { conversationId, content: text });
      return { content: [{ type: "text", text: "Ack sent." }] };
    },
  );

  server.registerTool(
    "spawn_agent",
    {
      description: "Spawn a Codex-backed sub-agent for real work.",
      inputSchema: z.object({
        task: z.string(),
        integrations: z.array(z.string()).default([]),
        name: z.string().optional(),
      }),
    },
    async ({ task, integrations, name }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const res = await spawnExecutionAgent({
        task,
        integrations,
        conversationId,
        name,
      });
      return {
        content: [
          {
            type: "text",
            text: `[agent ${res.agentId} ${res.status}]\n\n${res.result}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "save_draft",
    {
      description: "Save a draft of an external action for later approval.",
      inputSchema: z.object({
        kind: z.string(),
        summary: z.string(),
        payload: z.string(),
      }),
    },
    async ({ kind, summary, payload }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const draftId = randomId("draft");
      await convex.mutation(api.drafts.create, {
        draftId,
        conversationId,
        kind,
        summary,
        payload,
      });
      return {
        content: [
          {
            type: "text",
            text: `Draft saved as ${draftId}. Ask the user to confirm "send" or "cancel".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_drafts",
    {
      description: "List pending drafts for this conversation.",
      inputSchema: z.object({}),
    },
    async () => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const drafts = await convex.query(api.drafts.pendingByConversation, {
        conversationId,
      });
      return {
        content: [
          {
            type: "text",
            text: drafts.length
              ? drafts.map((d) => `• [${d.draftId}] (${d.kind}) ${d.summary}`).join("\n")
              : "No pending drafts.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "send_draft",
    {
      description: "Approve a pending draft and execute it with the provided integrations.",
      inputSchema: z.object({
        draftId: z.string(),
        integrations: z.array(z.string()),
      }),
    },
    async ({ draftId, integrations }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const draft = await convex.query(api.drafts.get, { draftId });
      if (!draft || draft.status !== "pending") {
        return { content: [{ type: "text", text: `Draft ${draftId} not found or already decided.` }] };
      }
      await convex.mutation(api.drafts.setStatus, {
        draftId,
        status: "sent",
      });
      const res = await spawnExecutionAgent({
        task: `Execute this approved draft.
kind: ${draft.kind}
summary: ${draft.summary}
payload JSON: ${draft.payload}`,
        integrations,
        conversationId,
        name: `send:${draft.kind}`,
      });
      return {
        content: [
          {
            type: "text",
            text: `Draft ${draftId} executed.\n\n${res.result}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "reject_draft",
    {
      description: "Reject a pending draft.",
      inputSchema: z.object({ draftId: z.string() }),
    },
    async ({ draftId }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      await convex.mutation(api.drafts.setStatus, {
        draftId,
        status: "rejected",
      });
      return { content: [{ type: "text", text: `Draft ${draftId} rejected.` }] };
    },
  );

  const tierEnum = z.enum(["short", "long", "permanent"]);
  const segmentEnum = z.enum([
    "identity",
    "preference",
    "relationship",
    "project",
    "knowledge",
    "context",
  ]);
  server.registerTool(
    "write_memory",
    {
      description: "Persist a durable memory about the user.",
      inputSchema: z.object({
        content: z.string(),
        segment: segmentEnum,
        importance: z.number().min(0).max(1),
        tier: tierEnum.optional(),
        supersedes: z.array(z.string()).optional(),
      }),
    },
    async ({ content, segment, importance, tier, supersedes }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const resolvedTier = tier ?? SEGMENT_PREFERRED_TIER[segment];
      const memoryId = makeMemoryId();
      const embedding = (await embed(content)) ?? undefined;
      await convex.mutation(api.memoryRecords.upsert, {
        memoryId,
        content,
        tier: resolvedTier,
        segment,
        importance,
        decayRate: DEFAULT_DECAY[resolvedTier],
        supersedes,
        embedding,
      });
      await convex.mutation(api.memoryEvents.emit, {
        eventType: "memory.written",
        conversationId,
        memoryId,
        data: JSON.stringify({ tier: resolvedTier, segment, importance }),
      });
      return { content: [{ type: "text", text: `Stored ${memoryId}.` }] };
    },
  );

  server.registerTool(
    "recall",
    {
      description: "Search memories for relevant facts.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional().default(10),
      }),
    },
    async ({ query, limit }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      let results: any[] = [];
      let mode: "vector" | "substring" = "substring";
      if (embeddingsAvailable()) {
        const queryVec = await embed(query);
        if (queryVec) {
          const hits = await convex.action(api.memoryRecords.vectorSearch, {
            embedding: queryVec,
            limit,
          });
          results = hits.map((hit) => hit.record);
          mode = "vector";
        }
      }
      if (results.length === 0) {
        results = await convex.query(api.memoryRecords.search, { query, limit });
      }
      for (const r of results) {
        await convex.mutation(api.memoryRecords.markAccessed, { memoryId: r.memoryId });
      }
      await convex.mutation(api.memoryEvents.emit, {
        eventType: "memory.recalled",
        conversationId,
        data: JSON.stringify({ query, hits: results.length, mode }),
      });
      return {
        content: [
          {
            type: "text",
            text: results.length
              ? results.map((r) => `• [${r.tier}/${r.segment}] ${r.memoryId}: ${r.content}`).join("\n")
              : "No memories matched.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_config",
    {
      description: "Return runtime configuration for Kizuna.",
      inputSchema: z.object({}),
    },
    async () => {
      const connected = await listConnectedToolkits();
      return {
        content: [
          {
            type: "text",
            text: json({
              model: await getRuntimeModel(),
              envDefault: process.env.KIZUNA_MODEL ?? "auto",
              availableModels: [...KNOWN_MODELS],
              modelAliases: Object.keys(MODEL_ALIASES),
              integrationsLoaded: connected.map((toolkit) => toolkit.slug),
              connectedToolkits: connected.map((toolkit) => ({
                slug: toolkit.slug,
                account: toolkit.accountLabel ?? toolkit.accountEmail ?? toolkit.alias ?? "(unknown)",
                status: toolkit.status,
              })),
              composioEnabled: Boolean(process.env.COMPOSIO_API_KEY),
              embeddingsEnabled: Boolean(process.env.VOYAGE_API_KEY),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "set_model",
    {
      description: "Set the next-turn model used by Kizuna.",
      inputSchema: z.object({ model: z.string() }),
    },
    async ({ model }) => {
      const resolved = resolveModelInput(model);
      if (!resolved) {
        return { content: [{ type: "text", text: `Unknown model "${model}".` }] };
      }
      await setRuntimeModel(resolved);
      return { content: [{ type: "text", text: `Model override set to ${resolved}.` }] };
    },
  );

  server.registerTool(
    "list_integrations",
    {
      description: "List the user's connected integrations.",
      inputSchema: z.object({}),
    },
    async () => {
      const connected = await listConnectedToolkits();
      return {
        content: [
          {
            type: "text",
            text: connected.length
              ? json(
                  connected.map((toolkit) => ({
                    slug: toolkit.slug,
                    status: toolkit.status,
                    account: toolkit.accountLabel ?? toolkit.accountEmail ?? toolkit.alias ?? "(unknown)",
                    connectionId: toolkit.connectionId,
                  })),
                )
              : "No integrations are currently connected.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_composio_catalog",
    {
      description: "Search Composio's catalog for matching toolkits.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(50).optional().default(15),
      }),
    },
    async ({ query, limit }) => {
      const meta = await listToolkitMeta();
      const q = query.trim().toLowerCase();
      const matches: Array<{ slug: string; name: string; description?: string; toolsCount?: number }> = [];
      for (const toolkit of meta.values()) {
        const haystack = `${toolkit.slug} ${toolkit.name} ${toolkit.description ?? ""}`.toLowerCase();
        if (haystack.includes(q)) {
          matches.push({
            slug: toolkit.slug,
            name: toolkit.name,
            description: toolkit.description,
            toolsCount: toolkit.toolsCount,
          });
        }
        if (matches.length >= limit) break;
      }
      return {
        content: [{ type: "text", text: matches.length ? json(matches) : `No toolkits match "${query}".` }],
      };
    },
  );

  server.registerTool(
    "inspect_toolkit",
    {
      description: "Inspect a specific toolkit and optionally list its tools.",
      inputSchema: z.object({
        slug: z.string(),
        includeTools: z.boolean().optional().default(false),
      }),
    },
    async ({ slug, includeTools }) => {
      const lower = slug.trim().toLowerCase();
      const meta = await listToolkitMeta();
      const toolkit = meta.get(lower);
      if (!toolkit) {
        return { content: [{ type: "text", text: `Toolkit "${lower}" is not in Composio's catalog.` }] };
      }
      const connected = (await listConnectedToolkits()).filter((item) => item.slug === lower);
      const result: Record<string, unknown> = {
        slug: toolkit.slug,
        name: toolkit.name,
        description: toolkit.description,
        toolsCount: toolkit.toolsCount,
        connections: connected,
        availableForSpawn: connected.length > 0,
      };
      if (includeTools) {
        result.tools = await listToolsForToolkit(lower);
      }
      return { content: [{ type: "text", text: json(result) }] };
    },
  );

  server.registerTool(
    "create_automation",
    {
      description: "Schedule a recurring task.",
      inputSchema: z.object({
        name: z.string(),
        schedule: z.string(),
        task: z.string(),
        integrations: z.array(z.string()).optional().default([]),
        notify: z.boolean().optional().default(true),
      }),
    },
    async ({ name, schedule, task, integrations, notify }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const validation = validateSchedule(schedule);
      if (!validation.valid) {
        return { content: [{ type: "text", text: `Invalid cron expression: ${validation.error}` }] };
      }
      const automationId = randomId("auto");
      const nextRunAt = nextRunFor(schedule) ?? undefined;
      await convex.mutation(api.automations.create, {
        automationId,
        name,
        task,
        integrations,
        schedule,
        conversationId,
        notifyConversationId: notify ? conversationId : undefined,
        nextRunAt,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created automation ${automationId} "${name}" — next run: ${
              nextRunAt ? new Date(nextRunAt).toLocaleString() : "unknown"
            }.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_automations",
    {
      description: "List automations for this conversation.",
      inputSchema: z.object({ enabledOnly: z.boolean().optional().default(false) }),
    },
    async ({ enabledOnly }) => {
      if (!conversationId) {
        return { content: [{ type: "text", text: "Conversation context is missing." }] };
      }
      const all = await convex.query(api.automations.list, { enabledOnly });
      const mine = all.filter((automation) => automation.conversationId === conversationId);
      return {
        content: [
          {
            type: "text",
            text: mine.length
              ? mine.map((a) => `• [${a.automationId}] ${a.enabled ? "●" : "○"} "${a.name}" — ${a.schedule}`).join("\n")
              : "No automations.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "toggle_automation",
    {
      description: "Enable or disable an automation.",
      inputSchema: z.object({ automationId: z.string(), enabled: z.boolean() }),
    },
    async ({ automationId, enabled }) => {
      const id = await convex.mutation(api.automations.setEnabled, { automationId, enabled });
      return { content: [{ type: "text", text: id ? `Set ${automationId} enabled=${enabled}.` : "Not found." }] };
    },
  );

  server.registerTool(
    "delete_automation",
    {
      description: "Delete an automation.",
      inputSchema: z.object({ automationId: z.string() }),
    },
    async ({ automationId }) => {
      const id = await convex.mutation(api.automations.remove, { automationId });
      return { content: [{ type: "text", text: id ? `Deleted ${automationId}.` : "Not found." }] };
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[kizuna-core-mcp] failed", err);
  process.exitCode = 1;
});
