type Props = { isDark: boolean };

const channels = [
  { name: "Telegram", env: "TELEGRAM_BOT_TOKEN", status: "Polling", note: "Set TELEGRAM_BOT_TOKEN and restart dev. No public webhook/tunnel required." },
];

export function CommunicationPanel({ isDark }: Props) {
  return (
    <div className="editorial-panel-shell h-full overflow-hidden">
      <div className="border-b border-[var(--hairline)] px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Communication</h2>
        <p className="text-sm text-[var(--muted)]">
          Kizuna Agent uses Telegram polling for messages. Discord and Slack messaging are removed.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 p-6">
        {channels.map((c) => (
          <div key={c.name} className="editorial-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[var(--ink)]">{c.name}</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">{c.note}</p>
              </div>
              <span className="editorial-tag">{c.status}</span>
            </div>
            <div className="mt-4 editorial-card-soft px-3 py-2 text-xs mono text-[var(--ink)]">
              {c.env}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
