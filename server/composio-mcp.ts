import { Composio } from "@composio/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listConnectedToolkits, listToolkitMeta } from "./composio-data.js";

const apiKey = process.env.COMPOSIO_API_KEY;
const userId = process.env.COMPOSIO_USER_ID ?? "kizuna-default";
const allowedToolkits = new Set(
  (process.env.KIZUNA_ALLOWED_TOOLKITS ?? "")
    .split(",")
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean),
);

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function selectedToolkits(toolkits?: string[]): string[] | undefined {
  const cleaned = (toolkits ?? [])
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean);
  if (cleaned.length === 0) return allowedToolkits.size ? [...allowedToolkits] : undefined;
  if (!allowedToolkits.size) return cleaned;
  return cleaned.filter((slug) => allowedToolkits.has(slug));
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "kizuna-composio",
    version: "0.1.0",
  });

  server.registerTool(
    "list_connected_toolkits",
    {
      description: "List the user's connected integrations in Composio.",
      inputSchema: z.object({}),
    },
    async () => {
      const connected = await listConnectedToolkits();
      return {
        content: [{ type: "text", text: connected.length ? json(connected) : "No integrations are connected." }],
      };
    },
  );

  server.registerTool(
    "search_composio_tools",
    {
      description: "Search Composio's tool catalog by query and optional toolkit filter.",
      inputSchema: z.object({
        query: z.string(),
        toolkits: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional().default(12),
      }),
    },
    async ({ query, toolkits, limit }) => {
      if (!apiKey) {
        return { content: [{ type: "text", text: "COMPOSIO_API_KEY is not set." }] };
      }
      const composio = new Composio({ apiKey });
      const selected = selectedToolkits(toolkits);
      const list = selected?.length
        ? await composio.tools.getRawComposioTools({
            toolkits: selected,
            search: query,
            limit,
          })
        : await composio.tools.getRawComposioTools({
            search: query,
          });
      return {
        content: [
          {
            type: "text",
            text: json(
              list.slice(0, limit).map((tool) => ({
                slug: tool.slug,
                name: tool.name,
                toolkit: tool.toolkit?.slug,
                description: tool.description,
              })),
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "execute_composio_tool",
    {
      description: "Execute a Composio tool by slug with JSON arguments.",
      inputSchema: z.object({
        toolSlug: z.string(),
        arguments: z.record(z.unknown()).optional().default({}),
        connectedAccountId: z.string().optional(),
      }),
    },
    async ({ toolSlug, arguments: args, connectedAccountId }) => {
      if (!apiKey) {
        return { content: [{ type: "text", text: "COMPOSIO_API_KEY is not set." }] };
      }
      const composio = new Composio({ apiKey });
      const result = await composio.tools.execute(toolSlug, {
        userId,
        ...(connectedAccountId ? { connectedAccountId } : {}),
        arguments: args,
        dangerouslySkipVersionCheck: true,
      });
      return { content: [{ type: "text", text: json(result) }] };
    },
  );

  server.registerTool(
    "inspect_toolkit",
    {
      description: "Inspect a toolkit and optionally list its tools.",
      inputSchema: z.object({
        slug: z.string(),
        includeTools: z.boolean().optional().default(false),
      }),
    },
    async ({ slug, includeTools }) => {
      if (!apiKey) {
        return { content: [{ type: "text", text: "COMPOSIO_API_KEY is not set." }] };
      }
      const composio = new Composio({ apiKey });
      const meta = await listToolkitMeta();
      const lower = slug.trim().toLowerCase();
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
      };
      if (includeTools) {
        const tools = await composio.tools.getRawComposioTools({ toolkits: [lower], limit: 200 });
        result.tools = tools.map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
        }));
      }
      return { content: [{ type: "text", text: json(result) }] };
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[composio-mcp] failed", err);
  process.exitCode = 1;
});
