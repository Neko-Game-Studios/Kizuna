import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MachineRobotIcon,
  AiBrain02Icon,
  WorkflowCircle03Icon,
  Activity01Icon,
  Link04Icon,
  DashboardSquare01Icon,
  ArrowShrink02Icon,
  ChatGptIcon,
  TelegramIcon,
} from "@hugeicons/core-free-icons";
import { api } from "../../convex/_generated/api.js";
import { useSocket } from "./lib/useSocket.js";
import { DashboardPanel } from "./components/DashboardPanel.js";
import { AgentsPanel } from "./components/AgentsPanel.js";
import { AutomationsPanel } from "./components/AutomationsPanel.js";
import { MemoryPanel } from "./components/MemoryPanel.js";
import { EventsPanel } from "./components/EventsPanel.js";
import { ConnectionsPanel } from "./components/ConnectionsPanel.js";
import { ConsolidationPanel } from "./components/ConsolidationPanel.js";
import { CommunicationPanel } from "./components/CommunicationPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { VrmSidePanel } from "./components/VrmSidePanel.js";

type View =
  | "dashboard"
  | "agents"
  | "automations"
  | "memory"
  | "events"
  | "consolidation"
  | "connections"
  | "communication"
  | "chat";

type Theme = "dark" | "light";

const NAV_ICONS: Record<View, any> = {
  dashboard: DashboardSquare01Icon,
  agents: MachineRobotIcon,
  automations: WorkflowCircle03Icon,
  memory: AiBrain02Icon,
  events: Activity01Icon,
  consolidation: ArrowShrink02Icon,
  connections: Link04Icon,
  communication: TelegramIcon,
  chat: ChatGptIcon,
};

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "agents", label: "Agents" },
  { id: "automations", label: "Automations" },
  { id: "memory", label: "Memory" },
  { id: "events", label: "Events" },
  { id: "consolidation", label: "Consolidation" },
  { id: "chat", label: "Chat" },
  { id: "communication", label: "Communication" },
  { id: "connections", label: "Connections" },
];

function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem("kizuna-agent-theme") as Theme) || "light";
  } catch {
    return "light";
  }
}

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const { connected } = useSocket();

  const counts = useQuery(api.memoryRecords.countsByTier, {});
  const agents = useQuery(api.agents.list, {});
  const activeAgentCount = (agents ?? []).filter(
    (a) => a.status === "running" || a.status === "spawned",
  ).length;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    document.body.style.background = theme === "dark" ? "#020617" : "#f8fafc";
    document.body.style.color = theme === "dark" ? "#e2e8f0" : "#1e293b";
    localStorage.setItem("kizuna-agent-theme", theme);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <div
      className={`editorial-ui h-full flex flex-col ${isDark ? "dark" : "light"}`}
    >
      {/* Top bar */}
      <header
        className="editorial-topbar shrink-0"
      >
        <div className="flex items-center gap-3">
          <img src="/lunagotchi.png" alt="Kizuna Agent" className="w-7 h-7 rounded-lg" />
          <h1
            className="text-sm font-semibold tracking-[0.14em] uppercase text-[var(--ink)]"
          >
            Kizuna Agent
          </h1>
          <div
            className={`editorial-chip px-2.5 py-1 text-xs ${
              connected ? "text-emerald-600" : "text-rose-500"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {connected && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 pulse-ring" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  connected ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
            </span>
            {connected ? "Live" : "Disconnected"}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {counts && (
            <div className="flex items-center gap-4">
              <MetricPill label="Short" value={counts.short} isDark={isDark} />
              <MetricPill label="Long" value={counts.long} isDark={isDark} />
              <MetricPill
                label="Perm"
                value={counts.permanent}
                isDark={isDark}
                color={isDark ? "text-amber-400" : "text-amber-600"}
              />
            </div>
          )}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-full border border-[var(--hairline)] bg-[var(--canvas)] p-2 text-[var(--ink)] transition-colors hover:bg-[var(--surface-soft)]"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {isDark ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav
          className="editorial-rail flex flex-col py-2"
        >
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`editorial-nav-item ${view === item.id ? "editorial-nav-item-active" : ""}`}
            >
              <HugeiconsIcon icon={NAV_ICONS[item.id]} size={18} className="shrink-0" />
              {item.label}
              {item.id === "agents" && activeAgentCount > 0 && (
                <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[var(--ink)] text-white">
                  {activeAgentCount}
                </span>
              )}
            </button>
          ))}

          <div className="mt-auto px-4 py-3 flex items-center gap-2">
            <img src="/appicon.png" alt="" className="w-5 h-5 rounded" />
            <span
              className={`text-[10px] ${isDark ? "text-slate-600" : "text-slate-400"} mono`}
            >
              v0.1
            </span>
          </div>
        </nav>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-hidden debug-scroll bg-[var(--canvas)]">
          <div className="h-full overflow-auto debug-scroll p-6 fade-in">
            {view === "dashboard" && <DashboardPanel isDark={isDark} />}
            {view === "agents" && <AgentsPanel isDark={isDark} />}
            {view === "automations" && <AutomationsPanel isDark={isDark} />}
            {view === "memory" && <MemoryPanel isDark={isDark} />}
            {view === "events" && <EventsPanel isDark={isDark} />}
            {view === "consolidation" && <ConsolidationPanel isDark={isDark} />}
            {view === "chat" && <ChatPanel isDark={isDark} onPrintingChange={setIsAvatarTalking} />}
            {view === "communication" && <CommunicationPanel isDark={isDark} />}
            {view === "connections" && <ConnectionsPanel isDark={isDark} />}
          </div>
        </main>

        {view === "chat" && (
          <aside
            className="hidden min-w-[360px] w-[32%] lg:block border-l border-[var(--hairline)] bg-[var(--surface-soft)]"
          >
            <VrmSidePanel isDark={isDark} isTalking={isAvatarTalking} />
          </aside>
        )}
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  isDark,
  color,
}: {
  label: string;
  value: number;
  isDark: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`mono font-semibold ${color ?? "text-[var(--ink)]"}`}>
        {value}
      </span>
    </div>
  );
}
