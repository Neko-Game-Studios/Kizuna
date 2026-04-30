const MAX_CHUNK = 2900;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

function chunks(text: string, size = MAX_CHUNK): string[] {
  const plain = stripMarkdown(text);
  if (plain.length <= size) return [plain];
  const out: string[] = [];
  let buf = "";
  for (const line of plain.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — not sending");
    return;
  }
  for (const part of chunks(text, 3900)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part }),
    });
    if (!res.ok) console.error(`[telegram] send failed ${res.status}: ${await res.text()}`);
  }
}

export async function sendToConversation(conversationId: string, text: string): Promise<void> {
  if (conversationId.startsWith("telegram:")) return sendTelegram(conversationId.slice(9), text);
}
