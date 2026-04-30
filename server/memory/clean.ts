import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_THRESHOLD = 0.05;
const ARCHIVE_THRESHOLD = 0.15;
const DECAY_BETA = 0.8;
const BASE_HALF_LIFE_DAYS = 11.25;
const LN2 = Math.log(2);
function effectiveScore(mem: {
  importance: number;
  decayRate: number;
  lastAccessedAt: number;
  accessCount: number;
}): number {
  const daysSinceAccess = Math.max(0, (Date.now() - mem.lastAccessedAt) / DAY_MS);
  const adaptiveHalfLife = BASE_HALF_LIFE_DAYS * (1 + mem.importance);
  const lambda = (LN2 / Math.max(adaptiveHalfLife, 0.001)) * DECAY_BETA;
  const effectiveLambda = lambda * (1 + mem.decayRate);
  const decayed = mem.importance * Math.exp(-effectiveLambda * daysSinceAccess);
  const reinforcement = 1 + Math.log1p(mem.accessCount) * 0.1;
  return clamp(decayed * reinforcement, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function cleanMemories(): Promise<{
  scanned: number;
  archived: number;
  pruned: number;
}> {
  const active = await convex.query(api.memoryRecords.list, { lifecycle: "active", limit: 500 });
  let archived = 0;
  let pruned = 0;

  for (const mem of active) {
    if (mem.tier === "permanent") continue;
    const score = effectiveScore(mem);
    if (score < PRUNE_THRESHOLD) {
      await convex.mutation(api.memoryRecords.setLifecycle, {
        memoryId: mem.memoryId,
        lifecycle: "pruned",
      });
      pruned++;
    } else if (score < ARCHIVE_THRESHOLD && mem.tier !== "long") {
      await convex.mutation(api.memoryRecords.setLifecycle, {
        memoryId: mem.memoryId,
        lifecycle: "archived",
      });
      archived++;
    }
  }

  await convex.mutation(api.memoryEvents.emit, {
    eventType: "memory.cleaned",
    data: JSON.stringify({ scanned: active.length, archived, pruned }),
  });

  return { scanned: active.length, archived, pruned };
}

export function startCleanupLoop(intervalMs = 6 * 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    cleanMemories().catch((err) => console.error("[memory.clean] loop error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}
