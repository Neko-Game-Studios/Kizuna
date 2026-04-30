import { Codex, type ThreadOptions } from "@openai/codex-sdk";
const codex = process.env.OPENAI_API_KEY
  ? new Codex({ apiKey: process.env.OPENAI_API_KEY })
  : new Codex();

export async function askCodex(prompt: string, systemPrompt: string, model: string): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const options: ThreadOptions = {
    sandboxMode: "read-only",
    approvalPolicy: "never",
    webSearchMode: "live",
    networkAccessEnabled: true,
    skipGitRepoCheck: true,
  };
  if (model && model !== "auto" && model !== "default") options.model = model;

  const thread = codex.startThread(options);

  const turn = await thread.run(`${systemPrompt}\n\n${prompt}`);
  return {
    text: turn.finalResponse?.trim() || "(no reply)",
    inputTokens: turn.usage?.input_tokens ?? 0,
    outputTokens: turn.usage?.output_tokens ?? 0,
  };
}
