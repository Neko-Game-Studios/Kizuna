import { Codex, type ThreadOptions } from "@openai/codex-sdk";

// Per @openai/codex-sdk docs, use `new Codex()` to inherit the signed-in Codex
// CLI session. Only pass apiKey when the user explicitly provides one.
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
  // For ChatGPT/Codex subscription auth, the CLI knows the right default model.
  // Passing gpt-5-codex explicitly can fail for ChatGPT accounts, so "auto"
  // means: omit --model and let Codex choose.
  if (model && model !== "auto" && model !== "default") options.model = model;

  const thread = codex.startThread(options);

  const turn = await thread.run(`${systemPrompt}\n\n${prompt}`);
  return {
    text: turn.finalResponse?.trim() || "(no reply)",
    inputTokens: turn.usage?.input_tokens ?? 0,
    outputTokens: turn.usage?.output_tokens ?? 0,
  };
}
