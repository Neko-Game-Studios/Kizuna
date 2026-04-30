import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

type Props = { isDark: boolean; onPrintingChange?: (printing: boolean) => void };

type ChatMessage = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export function ChatPanel({ isDark, onPrintingChange }: Props) {
  const [conversationId, setConversationId] = useState("chat:debug");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [printedById, setPrintedById] = useState<Record<string, string>>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messages = (useQuery(api.messages.list, { conversationId, limit: 80 }) ?? []) as ChatMessage[];
  const ordered = useMemo(() => [...messages].reverse(), [messages]);
  const previousConversationIdRef = useRef(conversationId);
  const latestAssistantIdRef = useRef<string | null>(null);
  const hasHydratedRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);

  const clearReveal = () => {
    if (revealTimerRef.current !== null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setIsPrinting(false);
  };

  const splitIntoTokens = (text: string) => text.match(/\S+\s*/g) ?? [text];

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [ordered, printedById]);
  useEffect(() => onPrintingChange?.(isPrinting), [isPrinting, onPrintingChange]);

  useEffect(() => {
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId;
      latestAssistantIdRef.current = null;
      hasHydratedRef.current = false;
      setPrintedById({});
      clearReveal();
    }
  }, [conversationId]);

  useEffect(() => {
    const latestAssistant = [...ordered].reverse().find((message) => message.role === "assistant");

    if (!hasHydratedRef.current) {
      latestAssistantIdRef.current = latestAssistant?._id ?? null;
      hasHydratedRef.current = true;
      return;
    }

    if (!latestAssistant) {
      clearReveal();
      latestAssistantIdRef.current = null;
      return;
    }

    if (latestAssistant._id === latestAssistantIdRef.current) return;

    latestAssistantIdRef.current = latestAssistant._id;
    clearReveal();

    const tokens = splitIntoTokens(latestAssistant.content);
    let tokenIndex = 0;
    setPrintedById((current) => ({ ...current, [latestAssistant._id]: "" }));
    setIsPrinting(true);

    const perTokenDelay = Math.max(45, Math.min(110, 1000 / Math.max(tokens.length / 2, 1)));
    const trailingPause = Math.min(1400, Math.max(300, tokens.length * 18));

    revealTimerRef.current = window.setInterval(() => {
      tokenIndex += 1;
      const printed = tokens.slice(0, tokenIndex).join("");
      setPrintedById((current) => ({ ...current, [latestAssistant._id]: printed }));

      if (tokenIndex >= tokens.length) {
        window.setTimeout(() => {
          setPrintedById((current) => ({ ...current, [latestAssistant._id]: latestAssistant.content }));
          clearReveal();
        }, trailingPause);
      }
    }, perTokenDelay);

    return clearReveal;
  }, [ordered]);

  const renderedMessages = useMemo(
    () =>
      ordered.map((message) => ({
        ...message,
        content: message.role === "assistant" ? printedById[message._id] ?? message.content : message.content,
      })),
    [ordered, printedById],
  );

  async function send() {
    const text = content.trim();
    if (!text || sending) return;
    setContent("");
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: text }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      setContent(text);
      alert(`Chat failed: ${err}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="editorial-panel-shell h-full flex flex-col gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-5 border-b border-[var(--hairline)] bg-[var(--canvas)]">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Chat</h2>
          <p className="text-sm text-[var(--muted)]">
            Local test chat. Use channel ids like <span className="mono">chat:debug</span> or <span className="mono">telegram:123</span>.
          </p>
        </div>
        <input
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          className="editorial-input w-64 px-3 py-2 text-sm mono"
        />
      </div>

      <div className="flex-1 overflow-auto bg-[var(--canvas)] p-6">
        {renderedMessages.length === 0 && (
          <div className="text-[var(--muted)]">No messages yet.</div>
        )}
        <div className="space-y-3">
          {renderedMessages.map((m) => (
            <div key={m._id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-[var(--ink)] text-white"
                  : "bg-[var(--surface-soft)] text-[var(--body)] border border-[var(--hairline)]"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {isPrinting && (
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider">
              Kizuna is speaking…
            </div>
          )}
          {sending && <div className="text-xs text-[var(--muted)] uppercase tracking-wider">Kizuna is thinking…</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex gap-3 px-6 py-5 border-t border-[var(--hairline)] bg-[var(--canvas)]">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message Kizuna…"
          className="editorial-textarea min-h-12 flex-1 resize-none px-4 py-3 text-sm leading-relaxed"
        />
        <button
          onClick={send}
          disabled={sending || !content.trim()}
          className="editorial-button-primary px-5 py-2 text-sm disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
