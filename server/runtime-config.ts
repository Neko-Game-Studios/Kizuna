import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

const MODEL_KEY = "model";
const MODEL_TTL_MS = 30 * 1000;
let cached: { at: number; value: string } | null = null;

// User-friendly aliases resolved to Codex/OpenAI model IDs.
export const MODEL_ALIASES: Record<string, string> = {
  auto: "auto",
  default: "auto",
  codex: "auto",
  "gpt-5-codex": "gpt-5-codex",
  "gpt 5 codex": "gpt-5-codex",
  gpt5: "gpt-5",
  "gpt-5": "gpt-5",
  "gpt 5": "gpt-5",
  fast: "gpt-4.1",
  "gpt-4.1": "gpt-4.1",
};

export const KNOWN_MODELS = new Set<string>(["auto", "gpt-5-codex", "gpt-5", "gpt-4.1"]);

export function resolveModelInput(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (KNOWN_MODELS.has(lower)) return lower;
  return MODEL_ALIASES[lower] ?? null;
}

function envFallback(): string {
  return process.env.BOOP_MODEL ?? "auto";
}

export async function getRuntimeModel(): Promise<string> {
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.value;
  let stored: string | null = null;
  try {
    stored = await convex.query(api.settings.get, { key: MODEL_KEY });
  } catch (err) {
    console.warn("[runtime-config] settings:get failed", err);
  }
  // Re-validate even though set_model writes through resolveModelInput — the
  // settings table is also writable via the Convex dashboard and other
  // mutations, and a bad value here would surface as an opaque model error on
  // the next turn instead of falling back gracefully.
  const final = stored && KNOWN_MODELS.has(stored) ? stored : envFallback();
  cached = { at: Date.now(), value: final };
  return final;
}

export async function setRuntimeModel(model: string): Promise<void> {
  await convex.mutation(api.settings.set, { key: MODEL_KEY, value: model });
  cached = { at: Date.now(), value: model };
}

export async function clearRuntimeModel(): Promise<void> {
  await convex.mutation(api.settings.clear, { key: MODEL_KEY });
  cached = null;
}
