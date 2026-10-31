// The cost meter (SPEC Phase 3 step 7). est_cost_usd in ai_usage_daily is the
// returned token usage times the configured per-million-token prices. Prompt
// caching bills writes at 1.25x and reads at 0.1x the input price, so both are
// configurable multipliers. A call aborted at its deadline returns no usage, so
// its cost is an estimate (see estimateAbortedUsage).

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface AiPrices {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
}

export const DEFAULT_AI_PRICES: AiPrices = Object.freeze({
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
});

export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
});

type Env = Readonly<Record<string, string | undefined>>;

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** AI_PRICE_INPUT_PER_MTOK, AI_PRICE_OUTPUT_PER_MTOK, AI_PRICE_CACHE_WRITE_MULTIPLIER, AI_PRICE_CACHE_READ_MULTIPLIER. */
export function readAiPrices(env: Env = process.env): AiPrices {
  return {
    inputPerMTok: nonNegativeNumber(env.AI_PRICE_INPUT_PER_MTOK, DEFAULT_AI_PRICES.inputPerMTok),
    outputPerMTok: nonNegativeNumber(env.AI_PRICE_OUTPUT_PER_MTOK, DEFAULT_AI_PRICES.outputPerMTok),
    cacheWriteMultiplier: nonNegativeNumber(env.AI_PRICE_CACHE_WRITE_MULTIPLIER, DEFAULT_AI_PRICES.cacheWriteMultiplier),
    cacheReadMultiplier: nonNegativeNumber(env.AI_PRICE_CACHE_READ_MULTIPLIER, DEFAULT_AI_PRICES.cacheReadMultiplier),
  };
}

/**
 * (input × in + cacheCreation × in × write + cacheRead × in × read + output × out) / 1e6.
 * `input` is the uncached input only, as the API reports it.
 */
export function estCostUsd(usage: TokenUsage, prices: AiPrices = DEFAULT_AI_PRICES): number {
  return (
    usage.inputTokens * prices.inputPerMTok
    + usage.cacheCreationInputTokens * prices.inputPerMTok * prices.cacheWriteMultiplier
    + usage.cacheReadInputTokens * prices.inputPerMTok * prices.cacheReadMultiplier
    + usage.outputTokens * prices.outputPerMTok
  ) / 1_000_000;
}

/**
 * A conservative guess for a call that returned no usage: about four characters
 * per input token, and the whole `max_tokens` as output.
 */
export function estimateAbortedUsage(promptChars: number, maxTokens: number): TokenUsage {
  return {
    inputTokens: Math.ceil(Math.max(0, promptChars) / 4),
    outputTokens: Math.max(0, maxTokens),
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/** ai_usage_daily.est_cost_usd is numeric(12,6). */
export const roundUsd = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
