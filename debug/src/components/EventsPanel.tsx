import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

const EVENT_COLOR: Record<string, string> = {
  "memory.written": "bg-emerald-500/20 text-emerald-400",
  "memory.recalled": "bg-sky-500/20 text-sky-400",
  "memory.extracted": "bg-violet-500/20 text-violet-400",
  "memory.consolidated": "bg-amber-500/20 text-amber-400",
  "memory.cleaned": "bg-slate-500/20 text-slate-400",
};

export function EventsPanel({ isDark }: { isDark: boolean }) {
  const events = useQuery(api.memoryEvents.recent, { limit: 200 });

  return (
    <div className="editorial-panel-shell p-6">
      <h2 className="text-[11px] uppercase tracking-[0.16em] mb-4 text-[var(--muted)]">
        Recent events
      </h2>
      {!events ? (
        <div className="py-6 text-center text-sm text-[var(--muted)]">Loading…</div>
      ) : events.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--muted)]">
          No events yet. Chat with the agent to see memory events stream in.
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e._id} className="editorial-card p-3">
              <div className="flex items-center gap-2 text-[10px] mono">
                <span
                  className={`px-1.5 py-0.5 rounded-full ${EVENT_COLOR[e.eventType] ?? "bg-[var(--surface-soft)] text-[var(--muted)]"}`}
                >
                  {e.eventType}
                </span>
                {e.conversationId && <span className="text-[var(--muted)]">{e.conversationId}</span>}
                {e.memoryId && <span className="text-[var(--muted)]">mem:{e.memoryId.slice(-6)}</span>}
                {e.agentId && <span className="text-[var(--muted)]">agent:{e.agentId.slice(-6)}</span>}
                <span className="text-[var(--muted)] ml-auto">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
              </div>
              {e.data && (
                <div
                  className="text-[11px] mono mt-1 break-all text-[var(--body)]"
                >
                  {e.data}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
