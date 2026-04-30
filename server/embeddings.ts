/**
 * Thin embeddings wrapper. Prefers Voyage (Anthropic-recommended). Falls back to OpenAI.
 * Returns null if no provider is configured — callers should fall back to substring search.
 *
 * Both providers here produce 1024-dim vectors (matches the Convex vector index).
 */

const VOYAGE_MODEL = "voyage-3";
const OPENAI_MODEL = "text-embedding-3-large";
const DIMENSIONS = 1024;

export function embeddingsAvailable(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY || process.env.OPENAI_API_KEY);
}

async function embedVoyage(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      output_dimension: DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function embedOpenAI(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: text,
      dimensions: DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

export async function embed(text: string): Promise<number[] | null> {
  try {
    if (process.env.VOYAGE_API_KEY) return await embedVoyage(text);
    if (process.env.OPENAI_API_KEY) return await embedOpenAI(text);
    return null;
  } catch (err) {
    console.warn("[embeddings] failed, falling back to null:", err);
    return null;
  }
}
