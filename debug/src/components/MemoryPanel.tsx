import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";
import MemoryGraphView from "./MemoryGraphView.js";

type Tier = "all" | "short" | "long" | "permanent";
type Segment = "all" | "identity" | "preference" | "relationship" | "project" | "knowledge" | "context";
type ViewMode = "table" | "graph";

const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
  { value: "permanent", label: "Permanent" },
];

const SEGMENT_OPTIONS: Segment[] = [
  "all",
  "identity",
  "preference",
  "relationship",
  "project",
  "knowledge",
  "context",
];

export function MemoryPanel({ isDark }: { isDark: boolean }) {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [tierFilter, setTierFilter] = useState<Tier>("all");
  const [segmentFilter, setSegmentFilter] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const records = useQuery(api.memoryRecords.list, {
    tier: tierFilter !== "all" ? (tierFilter as any) : undefined,
    lifecycle: "active",
    limit: 500,
  });

  const allRecords = records ?? [];
  const filtered = allRecords.filter((r: any) => {
    if (segmentFilter !== "all" && r.segment !== segmentFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (r.content ?? "").toLowerCase().includes(q) ||
        (r.memoryId ?? "").toLowerCase().includes(q) ||
        (r.segment ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const btnActive = "bg-[var(--ink)] text-white font-medium";
  const btnInactive = "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-soft)]";

  return (
    <div className="editorial-panel-shell flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div
        className="shrink-0 border-b border-[var(--hairline)] px-6 py-4 flex flex-wrap items-center gap-3 bg-[var(--canvas)]"
      >
        <div
          className="flex items-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] p-0.5"
        >
          {(["table", "graph"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-xs capitalize transition-colors rounded-full ${
                viewMode === mode ? btnActive : btnInactive
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {viewMode === "table" && (
          <>
            <div className="flex items-center gap-1">
              {TIER_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTierFilter(t.value)}
                  className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                    tierFilter === t.value ? btnActive : btnInactive
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <select
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value as Segment)}
              className="editorial-select text-xs px-3 py-1.5 focus:outline-none"
            >
              {SEGMENT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All segments" : s}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories…"
              className="editorial-input flex-1 min-w-[200px] text-sm px-3 py-1.5 placeholder:text-[var(--muted)]"
            />

            <span
              className="text-xs mono text-[var(--muted)]"
            >
              {filtered.length}/{allRecords.length}
            </span>
          </>
        )}
      </div>

      {viewMode === "graph" && (
        <div className="flex-1 min-h-0">
          <MemoryGraphView records={allRecords as any} isDark={isDark} />
        </div>
      )}

      {viewMode === "table" && (
        <div className="flex-1 overflow-y-auto debug-scroll">
          {records === undefined ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-lg shimmer bg-[var(--surface-soft)]"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-center py-12 text-[var(--muted)]">
              No records match your filters
            </p>
          ) : (
            <div className="divide-y divide-[var(--hairline)]">
              {filtered.map((r: any) => {
                const isExpanded = expandedId === r.memoryId;

                return (
                  <div
                    key={r.memoryId}
                    className="px-6 py-4 cursor-pointer transition-colors hover:bg-[var(--surface-soft)]"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : r.memoryId)
                    }
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="editorial-tag">
                        {r.tier}
                      </span>
                      <span
                        className="text-[10px] font-semibold text-[var(--muted)]"
                      >
                        {r.segment}
                      </span>
                      <span
                        className="text-[10px] mono ml-auto text-[var(--muted)]"
                      >
                        {(r.importance ?? 0).toFixed(2)}
                      </span>
                      <span
                        className="text-[10px] mono text-[var(--muted)]"
                      >
                        {r.accessCount ?? 0}x
                      </span>
                    </div>

                    <p
                      className={`text-sm text-[var(--body)] ${isExpanded ? "" : "line-clamp-2"}`}
                    >
                      {r.content}
                    </p>

                    {isExpanded && (
                      <div className="mt-3 space-y-2 text-xs slide-down">
                        <div
                          className="grid grid-cols-2 gap-x-6 gap-y-1 text-[var(--muted)]"
                        >
                          <div>
                            ID:{" "}
                            <span
                              className="mono text-[var(--ink)]"
                            >
                              {r.memoryId}
                            </span>
                          </div>
                          <div>
                            Decay:{" "}
                            <span
                              className="mono text-[var(--ink)]"
                            >
                              {r.decayRate}
                            </span>
                          </div>
                          {r.sourceTurn && (
                            <div>
                              Turn:{" "}
                              <span className="mono text-[var(--ink)]">
                                {r.sourceTurn}
                              </span>
                            </div>
                          )}
                          <div>
                            Last accessed:{" "}
                            <span className="text-[var(--ink)]">
                              {new Date(r.lastAccessedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
