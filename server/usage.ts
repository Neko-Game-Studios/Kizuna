export interface UsageTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export const EMPTY_USAGE: UsageTotals = {
  model: "unknown",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};
export function usageFromCodexTurn(
  usage: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  } | null | undefined,
  requestedModel?: string,
): UsageTotals {
  return {
    model: requestedModel || "unknown",
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cached_input_tokens ?? 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}
