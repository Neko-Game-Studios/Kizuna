import { Codex, type ThreadOptions, type ThreadItem } from "@openai/codex-sdk";

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;
type CodexConfigObject = { [key: string]: CodexConfigValue };

export interface AskCodexOptions {
  codexConfig?: CodexConfigObject;
  env?: Record<string, string>;
}

export async function askCodex(
  prompt: string,
  systemPrompt: string,
  model: string,
  options: AskCodexOptions = {},
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  items: ThreadItem[];
}> {
  const codex = new Codex({
    apiKey: process.env.OPENAI_API_KEY,
    ...(options.env ? { env: options.env } : {}),
    ...(options.codexConfig ? { config: options.codexConfig } : {}),
  });

  const threadOptions: ThreadOptions = {
    sandboxMode: "read-only",
    approvalPolicy: "never",
    webSearchMode: "live",
    networkAccessEnabled: true,
    skipGitRepoCheck: true,
  };
  if (model && model !== "auto" && model !== "default") threadOptions.model = model;

  const thread = codex.startThread(threadOptions);
  const turn = await thread.run(`${systemPrompt}\n\n${prompt}`);
  return {
    text: turn.finalResponse?.trim() || "(no reply)",
    inputTokens: turn.usage?.input_tokens ?? 0,
    outputTokens: turn.usage?.output_tokens ?? 0,
    items: turn.items,
  };
}
