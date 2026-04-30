import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

function formatSchedule(schedule: string): string {
  return schedule;
}

function timeAgo(ts?: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const STATUS_COLOR: Record<string, { dot: string; text: string }> = {
  running: { dot: "bg-sky-400 live-dot", text: "text-sky-400" },
  completed: { dot: "bg-emerald-400", text: "text-emerald-400" },
  failed: { dot: "bg-rose-400", text: "text-rose-400" },
};

export function AutomationsPanel({ isDark }: { isDark: boolean }) {
  const automations = useQuery(api.automations.list, {});
  const setEnabled = useMutation(api.automations.setEnabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cardBg = "editorial-card";
  const hoverBg = "hover:bg-[var(--surface-soft)]";
  const mutedText = "text-[var(--muted)]";

  const list = automations ?? [];
  const enabledCount = list.filter((a: any) => a.enabled).length;

  if (selectedId) {
    return (
      <AutomationDetail
        automationId={selectedId}
        onBack={() => setSelectedId(null)}
        isDark={isDark}
      />
    );
  }

  return (
    <div className="editorial-panel-shell flex flex-col h-full overflow-hidden">
      <div
        className="shrink-0 border-b border-[var(--hairline)] px-6 py-4 flex items-center gap-3 bg-[var(--canvas)]"
      >
        <h2 className="editorial-label">
          Automations
        </h2>
        <span className="text-xs mono text-[var(--muted)]">
          {enabledCount} enabled / {list.length} total
        </span>
      </div>

      <div className="flex-1 overflow-y-auto debug-scroll p-6 space-y-3">
        {automations === undefined ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-20 rounded-xl border ${cardBg} shimmer`} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm py-8 text-center text-[var(--muted)]">
            No automations yet. Text the agent: <em>"every morning at 8, summarize my calendar"</em>.
          </p>
        ) : (
          list.map((auto: any) => (
            <div
              key={auto._id}
              className={`border rounded-xl p-4 cursor-pointer transition-all duration-150 fade-in ${cardBg} ${hoverBg}`}
              onClick={() => setSelectedId(auto.automationId)}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabled({
                      automationId: auto.automationId,
                      enabled: !auto.enabled,
                    });
                  }}
                  className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 ${
                    auto.enabled
                      ? "bg-emerald-500"
                      : isDark
                        ? "bg-slate-700"
                        : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      auto.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>

                <span
                  className={`text-sm font-medium truncate text-[var(--ink)] ${!auto.enabled ? "opacity-50" : ""}`}
                >
                  {auto.name}
                </span>

                <span
                  className="editorial-tag"
                >
                  Scheduled
                </span>

                <span className="text-xs ml-auto mono text-[var(--muted)]">
                  {formatSchedule(auto.schedule)}
                </span>
              </div>

              <p
                className={`text-xs truncate mb-2 ml-[46px] text-[var(--muted)] ${!auto.enabled ? "opacity-50" : ""}`}
              >
                {auto.task}
              </p>

              <div
                className="flex items-center gap-3 ml-[46px] text-[10px] mono text-[var(--muted)]"
              >
                {auto.lastRunAt && <span>Last run: {timeAgo(auto.lastRunAt)}</span>}
                {auto.nextRunAt && auto.enabled && (
                  <span>
                    Next:{" "}
                    {new Date(auto.nextRunAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                {auto.integrations.length > 0 && (
                  <span>integrations: {auto.integrations.join(", ")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AutomationDetail({
  automationId,
  onBack,
  isDark,
}: {
  automationId: string;
  onBack: () => void;
  isDark: boolean;
}) {
  const auto = useQuery(api.automations.get, { automationId });
  const runs = useQuery(api.automations.recentRuns, { automationId, limit: 30 });
  const setEnabled = useMutation(api.automations.setEnabled);
  const remove = useMutation(api.automations.remove);

  const mutedText = "text-[var(--muted)]";

  if (!auto) {
    return (
      <div className="p-5">
        <div
          className={`h-20 rounded-xl shimmer ${
            isDark ? "bg-slate-900/40" : "bg-slate-100"
          }`}
        />
      </div>
    );
  }

  return (
    <div className="editorial-panel-shell flex flex-col h-full overflow-hidden fade-in">
      <div
        className="shrink-0 border-b border-[var(--hairline)] px-6 py-4 flex items-center gap-3 bg-[var(--canvas)]"
      >
        <button
          onClick={onBack}
          className="text-xs rounded-full px-3 py-1.5 transition-colors bg-[var(--surface-soft)] text-[var(--ink)]"
        >
          ← Back
        </button>

        <button
          onClick={() =>
            setEnabled({ automationId: auto.automationId, enabled: !auto.enabled })
          }
          className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 ${
            auto.enabled
              ? "bg-emerald-500"
              : isDark
                ? "bg-slate-700"
                : "bg-slate-300"
          }`}
        >
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
              auto.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
            }`}
          />
        </button>

        <span className="text-sm font-medium text-[var(--ink)]">
          {auto.name}
        </span>

        <span className="editorial-tag">
          Scheduled
        </span>

        <span className="text-xs ml-auto mono text-[var(--muted)]">
          {formatSchedule(auto.schedule)}
        </span>

        <button
          onClick={() => {
            if (confirm(`Delete automation "${auto.name}"?`)) {
              remove({ automationId: auto.automationId });
              onBack();
            }
          }}
          className="text-[11px] text-rose-500 hover:text-rose-400"
        >
          Delete
        </button>
      </div>

      <div
        className="shrink-0 border-b border-[var(--hairline)] px-6 py-4 space-y-2 bg-[var(--canvas)]"
      >
        <div>
          <span
            className="text-[10px] font-bold mono text-[var(--muted)]"
          >
            TASK{" "}
          </span>
          <span className="text-xs text-[var(--body)]">
            {auto.task}
          </span>
        </div>
        {auto.integrations.length > 0 && (
          <div>
            <span
            className="text-[10px] font-bold mono text-[var(--muted)]"
          >
            INTEGRATIONS{" "}
          </span>
            <span className="text-xs text-[var(--body)]">
              {auto.integrations.join(", ")}
            </span>
          </div>
        )}
        {auto.nextRunAt && auto.enabled && (
          <div>
            <span
            className="text-[10px] font-bold mono text-[var(--muted)]"
          >
            NEXT RUN{" "}
          </span>
            <span className="text-xs text-[var(--body)]">
              {new Date(auto.nextRunAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto debug-scroll">
        <div className="px-6 py-3 border-b border-[var(--hairline)]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Run History ({runs?.length ?? 0})
          </span>
        </div>

        {runs === undefined ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded shimmer bg-[var(--surface-soft)]"
                />
              ))}
            </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-center py-8 text-[var(--muted)]">
            No runs yet
          </p>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {runs.map((run: any) => {
              const color = STATUS_COLOR[run.status] ?? STATUS_COLOR.running;
              return (
                <div
                  key={run._id}
                  className="px-6 py-3 hover:bg-[var(--surface-soft)]"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.dot}`}
                    />
                    <span className={`text-[10px] font-bold mono w-20 shrink-0 capitalize ${color.text}`}>
                      {run.status}
                    </span>
                    <span
                      className="text-xs flex-1 truncate text-[var(--body)]"
                    >
                      {run.result
                        ? run.result.slice(0, 120)
                        : run.error
                          ? run.error.slice(0, 120)
                          : "—"}
                    </span>
                    <span className="text-[10px] mono shrink-0 text-[var(--muted)]">
                      {run.startedAt ? timeAgo(run.startedAt) : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
