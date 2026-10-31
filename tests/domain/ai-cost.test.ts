import { describe, expect, it } from "vitest";
import { DEFAULT_AI_PRICES, addUsage, estCostUsd, estimateAbortedUsage, readAiPrices, roundUsd } from "@/lib/domain/ai-cost";

const usage = (inputTokens: number, outputTokens: number, cacheCreationInputTokens = 0, cacheReadInputTokens = 0) =>
  ({ inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens });

describe("estCostUsd", () => {
  it("prices input at $0.10 and output at $0.50 per million tokens by default", () => {
    expect(estCostUsd(usage(1_000_000, 0))).toBeCloseTo(0.1, 12);
    expect(estCostUsd(usage(0, 1_000_000))).toBeCloseTo(0.5, 12);
    expect(estCostUsd(usage(400, 30))).toBeCloseTo((400 * 0.1 + 30 * 0.5) / 1e6, 15);
  });

  it("prices cache writes at 1.25x and cache reads at 0.1x the input price", () => {
    expect(estCostUsd(usage(0, 0, 1_000_000, 0))).toBeCloseTo(0.125, 12);
    expect(estCostUsd(usage(0, 0, 0, 1_000_000))).toBeCloseTo(0.01, 12);
    // (100*0.10 + 600*0.10*1.25 + 900*0.10*0.1 + 40*0.50) / 1e6
    expect(estCostUsd(usage(100, 40, 600, 900))).toBeCloseTo((10 + 75 + 9 + 20) / 1e6, 15);
  });

  it("uses configured prices", () => {
    const prices = { inputPerMTok: 1, outputPerMTok: 5, cacheWriteMultiplier: 2, cacheReadMultiplier: 0.5 };
    expect(estCostUsd(usage(1000, 100, 1000, 1000), prices)).toBeCloseTo((1000 + 500 + 2000 + 500) / 1e6, 15);
  });

  it("is zero for no usage", () => {
    expect(estCostUsd(usage(0, 0))).toBe(0);
  });
});

describe("estimateAbortedUsage", () => {
  it("estimates input as prompt characters / 4 (rounded up) and output as max_tokens", () => {
    expect(estimateAbortedUsage(1001, 120)).toEqual(usage(251, 120));
    expect(estimateAbortedUsage(0, 120)).toEqual(usage(0, 120));
  });

  it("costs an aborted 2,000-character reaction prompt", () => {
    expect(estCostUsd(estimateAbortedUsage(2000, 120))).toBeCloseTo((500 * 0.1 + 120 * 0.5) / 1e6, 15);
  });
});

describe("readAiPrices", () => {
  it("defaults to the spec's prices and the cache multipliers", () => {
    expect(readAiPrices({})).toEqual(DEFAULT_AI_PRICES);
    expect(DEFAULT_AI_PRICES).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 });
  });

  it("reads the env and ignores invalid values", () => {
    expect(readAiPrices({ AI_PRICE_INPUT_PER_MTOK: "0.5", AI_PRICE_OUTPUT_PER_MTOK: "abc", AI_PRICE_CACHE_WRITE_MULTIPLIER: "-1", AI_PRICE_CACHE_READ_MULTIPLIER: "0" }))
      .toEqual({ inputPerMTok: 0.5, outputPerMTok: 0.5, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0 });
  });
});

describe("helpers", () => {
  it("adds usage and rounds to the column's 6 decimals", () => {
    expect(addUsage(usage(1, 2, 3, 4), usage(10, 20, 30, 40))).toEqual(usage(11, 22, 33, 44));
    expect(roundUsd(0.0000744999)).toBe(0.000074);
    expect(roundUsd(0.0000745001)).toBe(0.000075);
  });
});
