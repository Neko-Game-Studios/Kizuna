import { Composio } from "@composio/core";

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
  toolkit?: string;
}

let clientSingleton: Composio | null = null;
let toolkitMetaCache: Promise<Map<string, ToolkitMeta>> | null = null;
const toolsBySlugCache = new Map<string, { at: number; tools: ToolSummary[] }>();
const TOOLS_TTL_MS = 10 * 60 * 1000;

export function kizunaUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? "kizuna-default";
}

export function displayNameFor(slug: string): string {
  const found = CURATED_TOOLKITS.find((toolkit) => toolkit.slug === slug);
  return found?.displayName ?? humanize(slug);
}

export function getComposioClient(): Composio | null {
  if (clientSingleton) return clientSingleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  clientSingleton = new Composio({ apiKey });
  return clientSingleton;
}

export async function listConnectedToolkits(): Promise<ConnectedToolkit[]> {
  const composio = getComposioClient();
  if (!composio) return [];
  try {
    const resp = await composio.connectedAccounts.list({ userIds: [kizunaUserId()] });
    return resp.items.map((it) => ({
      slug: it.toolkit.slug,
      connectionId: it.id,
      status: it.status,
      alias: it.alias ?? undefined,
      accountLabel: extractAccountLabel(it),
      accountEmail: extractAccountEmail(it),
      accountName: extractAccountName(it),
      accountAvatarUrl: extractAccountAvatarUrl(it),
      createdAt: it.createdAt,
    }));
  } catch (err) {
    console.error("[composio-data] listConnectedToolkits failed", err);
    return [];
  }
}

export async function listToolkitMeta(): Promise<Map<string, ToolkitMeta>> {
  if (!toolkitMetaCache) {
    toolkitMetaCache = fetchToolkitMeta().catch((err) => {
      console.error("[composio-data] listToolkitMeta failed", err);
      toolkitMetaCache = null;
      return new Map<string, ToolkitMeta>();
    });
  }
  return toolkitMetaCache;
}

export async function listToolsForToolkit(slug: string): Promise<ToolSummary[]> {
  const cached = toolsBySlugCache.get(slug);
  if (cached && Date.now() - cached.at < TOOLS_TTL_MS) return cached.tools;
  const composio = getComposioClient();
  if (!composio) return [];
  try {
    const list = await composio.tools.getRawComposioTools({ toolkits: [slug], limit: 500 });
    const tools: ToolSummary[] = list.map((tool) => ({
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      toolkit: tool.toolkit?.slug,
    }));
    toolsBySlugCache.set(slug, { at: Date.now(), tools });
    return tools;
  } catch (err) {
    console.error(`[composio-data] listToolsForToolkit(${slug}) failed`, err);
    return [];
  }
}

export async function listToolkitSlugsWithAuthConfig(): Promise<Set<string>> {
  const composio = getComposioClient();
  if (!composio) return new Set();
  try {
    const resp = await composio.authConfigs.list({ limit: 200 });
    return new Set(resp.items.map((item) => item.toolkit.slug));
  } catch (err) {
    console.error("[composio-data] listToolkitSlugsWithAuthConfig failed", err);
    return new Set();
  }
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

export async function renameConnection(connectionId: string, alias: string): Promise<void> {
  const composio = getComposioClient();
  if (!composio) throw new Error("COMPOSIO_API_KEY not set");
  await composio.connectedAccounts.update(connectionId, { alias });
}

export async function disconnectToolkit(connectionId: string): Promise<void> {
  const composio = getComposioClient();
  if (!composio) throw new Error("COMPOSIO_API_KEY not set");
  await composio.connectedAccounts.delete(connectionId);
}

export async function authorizeToolkit(
  slug: string,
  opts?: { callbackUrl?: string; alias?: string },
): Promise<{ redirectUrl: string | null; connectionId: string }> {
  const composio = getComposioClient();
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
  const existing = (await listConnectedToolkits()).filter((c) => c.slug === slug && c.status === "ACTIVE");
  const conn = await composio.connectedAccounts.initiate(kizunaUserId(), authConfigId, {
    ...(existing.length > 0 ? { allowMultiple: true } : {}),
    ...(opts?.callbackUrl ? { callbackUrl: opts.callbackUrl } : {}),
    ...(opts?.alias ? { alias: opts.alias } : {}),
  });
  return { redirectUrl: conn.redirectUrl ?? null, connectionId: conn.id };
}

function extractAccountLabel(item: { state?: unknown; data?: unknown; alias?: string | null }): string | undefined {
  return extractIdentity(item.state, item.data).label ?? item.alias ?? undefined;
}

function extractAccountEmail(item: { state?: unknown; data?: unknown; alias?: string | null }): string | undefined {
  return extractIdentity(item.state, item.data).email ?? undefined;
}

function extractAccountName(item: { state?: unknown; data?: unknown; alias?: string | null }): string | undefined {
  return extractIdentity(item.state, item.data).name ?? undefined;
}

function extractAccountAvatarUrl(item: { state?: unknown; data?: unknown; alias?: string | null }): string | undefined {
  return extractIdentity(item.state, item.data).avatarUrl ?? undefined;
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

function humanize(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface AccountIdentity {
  email?: string;
  name?: string;
  avatarUrl?: string;
  label?: string;
}

function extractIdentity(state: unknown, data: unknown): AccountIdentity {
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

async function fetchToolkitMeta(): Promise<Map<string, ToolkitMeta>> {
  const composio = getComposioClient();
  if (!composio) return new Map();
  const out = new Map<string, ToolkitMeta>();
  const resp = await composio.toolkits.get({ limit: 500 });
  const items = Array.isArray(resp) ? resp : (resp as { items?: unknown[] }).items ?? [];
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
  return out;
}
