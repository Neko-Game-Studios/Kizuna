import { Composio } from "@composio/core";
import { ClaudeAgentSDKProvider } from "@composio/claude-agent-sdk";
import { createSdkMcpServer, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { IntegrationModule } from "./integrations/registry.js";

export type ToolkitAuthMode = "managed" | "byo";

export interface CuratedToolkit {
  slug: string;
  displayName: string;
  authMode: ToolkitAuthMode;
}
export const CURATED_TOOLKITS: CuratedToolkit[] = [
  { slug: "gmail", displayName: "Gmail", authMode: "managed" },
  { slug: "googlecalendar", displayName: "Google Calendar", authMode: "managed" },
  { slug: "googledrive", displayName: "Google Drive", authMode: "managed" },
  { slug: "googlesheets", displayName: "Google Sheets", authMode: "managed" },
  { slug: "googledocs", displayName: "Google Docs", authMode: "managed" },
  { slug: "github", displayName: "GitHub", authMode: "managed" },
  { slug: "linear", displayName: "Linear", authMode: "managed" },
  { slug: "notion", displayName: "Notion", authMode: "managed" },
  { slug: "hubspot", displayName: "HubSpot", authMode: "managed" },
  { slug: "trello", displayName: "Trello", authMode: "managed" },
  { slug: "asana", displayName: "Asana", authMode: "managed" },
  { slug: "jira", displayName: "Jira", authMode: "managed" },
  { slug: "airtable", displayName: "Airtable", authMode: "managed" },
  { slug: "figma", displayName: "Figma", authMode: "managed" },
  { slug: "dropbox", displayName: "Dropbox", authMode: "managed" },
  { slug: "stripe", displayName: "Stripe", authMode: "managed" },
  { slug: "supabase", displayName: "Supabase", authMode: "managed" },
  { slug: "granola_mcp", displayName: "Granola", authMode: "managed" },
  { slug: "salesforce", displayName: "Salesforce", authMode: "managed" },
  { slug: "twitter", displayName: "Twitter / X", authMode: "byo" },
  { slug: "linkedin", displayName: "LinkedIn", authMode: "managed" },
];

const DISPLAY_NAME_BY_SLUG = new Map(CURATED_TOOLKITS.map((t) => [t.slug, t.displayName]));

let singleton: Composio<ClaudeAgentSDKProvider> | null = null;

export function getComposio(): Composio<ClaudeAgentSDKProvider> | null {
  if (singleton) return singleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  singleton = new Composio<ClaudeAgentSDKProvider>({
    apiKey,
    provider: new ClaudeAgentSDKProvider(),
  });
  return singleton;
}

export function kizunaUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? "kizuna-default";
}

export function displayNameFor(slug: string): string {
  return DISPLAY_NAME_BY_SLUG.get(slug) ?? humanize(slug);
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export interface ConnectedToolkit {
  slug: string;
  connectionId: string;
  status: string;
  alias?: string;
  accountLabel?: string;
  accountEmail?: string;
  accountName?: string;
  accountAvatarUrl?: string;
  createdAt?: string;
}

export interface ToolkitMeta {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  toolsCount?: number;
}

export interface ToolSummary {
  slug: string;
  name: string;
  description?: string;
}
let toolkitMetaCache: Promise<Map<string, ToolkitMeta>> | null = null;

async function fetchAllToolkitMeta(): Promise<Map<string, ToolkitMeta>> {
  const composio = getComposio();
  if (!composio) return new Map();
  const out = new Map<string, ToolkitMeta>();
  const resp = await composio.toolkits.get({ limit: 500 });
  const items = Array.isArray(resp)
    ? resp
    : ((resp as { items?: unknown[] }).items ?? []);
  for (const it of items as Array<{
    slug: string;
    name: string;
    meta?: { logo?: string; description?: string; toolsCount?: number };
  }>) {
    out.set(it.slug, {
      slug: it.slug,
      name: it.name,
      logo: it.meta?.logo,
      description: it.meta?.description,
      toolsCount: it.meta?.toolsCount,
    });
  }
  await Promise.all(
    CURATED_TOOLKITS.filter((t) => !out.has(t.slug)).map(async (t) => {
      try {
        const full = (await composio.toolkits.get(t.slug)) as {
          slug: string;
          name: string;
          meta?: { logo?: string; description?: string; toolsCount?: number };
        };
        out.set(full.slug, {
          slug: full.slug,
          name: full.name,
          logo: full.meta?.logo,
          description: full.meta?.description,
          toolsCount: full.meta?.toolsCount,
        });
      } catch (err) {
        console.warn(`[composio] meta backfill failed for ${t.slug}`, err);
      }
    }),
  );
  return out;
}

export async function listToolkitMeta(): Promise<Map<string, ToolkitMeta>> {
  if (!toolkitMetaCache) {
    toolkitMetaCache = fetchAllToolkitMeta().catch((err) => {
      console.error("[composio] listToolkitMeta failed", err);
      toolkitMetaCache = null;
      return new Map<string, ToolkitMeta>();
    });
  }
  return toolkitMetaCache;
}

const toolsBySlugCache = new Map<string, { at: number; tools: ToolSummary[] }>();
const TOOLS_TTL_MS = 10 * 60 * 1000;

export async function listToolsForToolkit(slug: string): Promise<ToolSummary[]> {
  const cached = toolsBySlugCache.get(slug);
  if (cached && Date.now() - cached.at < TOOLS_TTL_MS) return cached.tools;
  const composio = getComposio();
  if (!composio) return [];
  try {
    const list = await composio.tools.getRawComposioTools({ toolkits: [slug], limit: 500 });
    const tools: ToolSummary[] = list.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
    }));
    toolsBySlugCache.set(slug, { at: Date.now(), tools });
    return tools;
  } catch (err) {
    console.error(`[composio] listToolsForToolkit(${slug}) failed`, err);
    return [];
  }
}

export async function listToolkitSlugsWithAuthConfig(): Promise<Set<string>> {
  const composio = getComposio();
  if (!composio) return new Set();
  try {
    const resp = await composio.authConfigs.list({ limit: 200 });
    return new Set(resp.items.map((it) => it.toolkit.slug));
  } catch (err) {
    console.error("[composio] listToolkitSlugsWithAuthConfig failed", err);
    return new Set();
  }
}
const identityCache = new Map<string, { at: number; identity: AccountIdentity }>();
const IDENTITY_TTL_MS = 15 * 60 * 1000;
interface WhoAmITool {
  tool: string;
  arguments: Record<string, unknown>;
  parse: (data: Record<string, unknown>) => Partial<AccountIdentity>;
}
function genericProfileParse(d: Record<string, unknown>): Partial<AccountIdentity> {
  const first = (...candidates: unknown[]): string | undefined => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return undefined;
  };
  const nested = (key: string): Record<string, unknown> =>
    (d[key] && typeof d[key] === "object" ? (d[key] as Record<string, unknown>) : {});
  const viewer = nested("viewer");
  const user = nested("user");
  const team = nested("team");
  const profile = nested("profile");

  const email = first(d.email, user.email, viewer.email, profile.email);
  const name = first(
    d.name,
    d.login,
    d.display_name,
    d.displayName,
    user.name,
    viewer.name,
    profile.name,
    team.name,
    d.companyName,
  );
  const avatar = first(
    d.avatar_url,
    d.avatarUrl,
    d.picture,
    user.avatar_url,
    viewer.avatarUrl,
    profile.image,
  );
  return { email, name, avatarUrl: avatar, label: email ?? name };
}

const WHOAMI_BY_TOOLKIT: Record<string, WhoAmITool> = {
  gmail: {
    tool: "GMAIL_GET_PROFILE",
    arguments: { user_id: "me" },
    parse: (d) => {
      const email = typeof d.emailAddress === "string" ? d.emailAddress : undefined;
      return { email, label: email };
    },
  },
  github: {
    tool: "GITHUB_GET_THE_AUTHENTICATED_USER",
    arguments: {},
    parse: genericProfileParse,
  },
  linear: { tool: "LINEAR_GET_CURRENT_USER", arguments: {}, parse: genericProfileParse },
  notion: { tool: "NOTION_GET_ABOUT_ME", arguments: {}, parse: genericProfileParse },
  hubspot: { tool: "HUBSPOT_GET_ACCOUNT_INFO", arguments: {}, parse: genericProfileParse },
  stripe: { tool: "STRIPE_GET_ACCOUNT", arguments: {}, parse: genericProfileParse },
};

async function fetchToolkitIdentity(
  composio: NonNullable<ReturnType<typeof getComposio>>,
  slug: string,
  connectedAccountId?: string,
): Promise<AccountIdentity> {
  const spec = WHOAMI_BY_TOOLKIT[slug];
  if (!spec) return {};
  try {
    const result = await composio.tools.execute(spec.tool, {
      userId: kizunaUserId(),
      ...(connectedAccountId ? { connectedAccountId } : {}),
      arguments: spec.arguments,
      dangerouslySkipVersionCheck: true,
    });
    if (!result.successful || !result.data) return {};
    return spec.parse(result.data as Record<string, unknown>);
  } catch (err) {
    console.warn(`[composio] whoami fetch failed for ${slug}`, err);
    return {};
  }
}

async function getIdentityFor(
  composio: NonNullable<ReturnType<typeof getComposio>>,
  id: string,
  slug: string,
  seed: AccountIdentity,
): Promise<AccountIdentity> {
  if (seed.label) return seed;
  const cached = identityCache.get(id);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.identity;
  let identity: AccountIdentity = {};
  try {
    const full = await composio.connectedAccounts.get(id);
    identity = extractAccountIdentity(
      (full as { state?: unknown }).state,
      (full as { data?: unknown }).data,
    );
  } catch (err) {
    console.warn(`[composio] failed to fetch identity for ${id}`, err);
  }
  if (!identity.label) {
    const whoami = await fetchToolkitIdentity(composio, slug, id);
    if (whoami.label) identity = { ...identity, ...whoami };
  }
  identityCache.set(id, { at: Date.now(), identity });
  return identity;
}

export async function listConnectedToolkits(): Promise<ConnectedToolkit[]> {
  const composio = getComposio();
  if (!composio) return [];
  try {
    const resp = await composio.connectedAccounts.list({ userIds: [kizunaUserId()] });
    const enriched = await Promise.all(
      resp.items.map(async (it) => {
        const seed = extractAccountIdentity(
          (it as { state?: unknown }).state,
          (it as { data?: unknown }).data,
        );
        const identity =
          it.status === "ACTIVE"
            ? await getIdentityFor(composio, it.id, it.toolkit.slug, seed)
            : seed;
        return {
          slug: it.toolkit.slug,
          connectionId: it.id,
          status: it.status,
          alias: it.alias ?? undefined,
          accountLabel: identity.label,
          accountEmail: identity.email,
          accountName: identity.name,
          accountAvatarUrl: identity.avatarUrl,
          createdAt: it.createdAt,
        };
      }),
    );
    return enriched;
  } catch (err) {
    console.error("[composio] listConnectedToolkits failed", err);
    return [];
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1]!;
    const padded = payload + "===".slice((payload.length + 3) % 4);
    const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface AccountIdentity {
  email?: string;
  name?: string;
  avatarUrl?: string;
  label?: string;
}
function extractAccountIdentity(state: unknown, data: unknown): AccountIdentity {
  const s = (state && typeof state === "object" ? (state as Record<string, unknown>) : {}) ?? {};
  const d = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) ?? {};
  const out: AccountIdentity = {};

  const idToken = str(s.id_token) ?? str(d.id_token);
  if (idToken) {
    const payload = decodeJwtPayload(idToken);
    if (payload) {
      out.email = str(payload.email);
      out.name = str(payload.name) ?? str(payload.given_name);
      out.avatarUrl = str(payload.picture);
    }
  }
  for (const src of [d, s]) {
    const profile =
      (src.user_info && typeof src.user_info === "object" ? (src.user_info as Record<string, unknown>) : null) ??
      (src.profile && typeof src.profile === "object" ? (src.profile as Record<string, unknown>) : null);
    if (profile) {
      out.email = out.email ?? str(profile.email);
      out.name = out.name ?? str(profile.name) ?? str(profile.display_name);
      out.avatarUrl = out.avatarUrl ?? str(profile.picture) ?? str(profile.avatar_url);
    }
    out.email = out.email ?? str(src.email);
    out.name = out.name ?? str(src.name) ?? str(src.display_name);
    out.avatarUrl = out.avatarUrl ?? str(src.avatar_url) ?? str(src.picture);
  }
  const fallback =
    str(s.shop) ??
    str(s.subdomain) ??
    str(s.domain) ??
    str(s.account_url) ??
    str(s.account_id) ??
    str(s.site_name) ??
    str(s.instanceName) ??
    str(d.shop) ??
    str(d.subdomain);

  out.label = out.email ?? out.name ?? fallback;
  return out;
}

export async function renameConnection(connectionId: string, alias: string): Promise<void> {
  const composio = getComposio();
  if (!composio) throw new Error("COMPOSIO_API_KEY not set");
  await composio.connectedAccounts.update(connectionId, { alias });
}

export class ComposioNeedsAuthConfigError extends Error {
  constructor(
    public readonly slug: string,
    public readonly underlying: string,
  ) {
    super(
      `Toolkit "${slug}" needs an auth config — Composio doesn't host a managed OAuth app for it. ` +
        `Add it via the Composio Dashboard: Toolkits → search ${slug} → Add to project → paste your OAuth credentials. ` +
        `https://dashboard.composio.dev`,
    );
    this.name = "ComposioNeedsAuthConfigError";
  }
}

export async function authorizeToolkit(
  slug: string,
  opts?: { callbackUrl?: string; alias?: string },
): Promise<{ redirectUrl: string | null; connectionId: string }> {
  const composio = getComposio();
  if (!composio) throw new Error("COMPOSIO_API_KEY not set");
  let authConfigId: string;
  const existingConfig = (await composio.authConfigs.list({ toolkit: slug })).items[0];
  if (existingConfig) {
    authConfigId = existingConfig.id;
  } else {
    try {
      const created = await composio.authConfigs.create(slug, {
        type: "use_composio_managed_auth",
        name: `${displayNameFor(slug)} Auth Config`,
      });
      authConfigId = created.id;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        throw new ComposioNeedsAuthConfigError(slug, String(err));
      }
      throw err;
    }
  }
  const existing = (await listConnectedToolkits()).filter(
    (c) => c.slug === slug && c.status === "ACTIVE",
  );
  const conn = await composio.connectedAccounts.initiate(kizunaUserId(), authConfigId, {
    ...(existing.length > 0 ? { allowMultiple: true } : {}),
    ...(opts?.callbackUrl ? { callbackUrl: opts.callbackUrl } : {}),
    ...(opts?.alias ? { alias: opts.alias } : {}),
  });
  return { redirectUrl: conn.redirectUrl ?? null, connectionId: conn.id };
}

export async function disconnectToolkit(connectionId: string): Promise<void> {
  const composio = getComposio();
  if (!composio) throw new Error("COMPOSIO_API_KEY not set");
  await composio.connectedAccounts.delete(connectionId);
}

export function buildComposioIntegrationModule(slug: string): IntegrationModule {
  return {
    name: slug,
    description: `${displayNameFor(slug)} (via Composio)`,
    requiredEnv: ["COMPOSIO_API_KEY"],
    createServer: async (): Promise<McpSdkServerConfigWithInstance> => {
      const composio = getComposio();
      if (!composio) {
        throw new Error(`[composio] cannot build ${slug} — COMPOSIO_API_KEY not set`);
      }
      const activeCount = (await listConnectedToolkits()).filter(
        (c) => c.slug === slug && c.status === "ACTIVE",
      ).length;
      const authConfig = (await composio.authConfigs.list({ toolkit: slug })).items[0];
      const session = await composio.create(kizunaUserId(), {
        toolkits: [slug],
        manageConnections: false,
        ...(authConfig ? { authConfigs: { [slug]: authConfig.id } } : {}),
        ...(activeCount >= 2
          ? { multiAccount: { enable: true, requireExplicitSelection: true } }
          : {}),
      });
      const tools = await session.tools();
      return createSdkMcpServer({
        name: slug,
        version: "0.1.0",
        tools,
      });
    },
  };
}
