import { beforeEach, describe, expect, it, vi } from "vitest";
import { findDistressKeywords, hasDistressKeyword } from "@/lib/safety/keywords";
import { KeywordPlusModelDetector, createDistressDetector, type KeywordPlusModelDeps, type VerdictCache } from "@/lib/safety/distress";
import { BoundedCache } from "@/lib/safety/memory-cache";
import type { AiMessageResult } from "@/lib/ai/anthropic";
import { message } from "../helpers/pivot-fixtures";

describe("distress keywords", () => {
  it.each([
    "I want to die",
    "thinking about suicide again",
    "kill myself",
    "Self-harm check in",
    "self harm",
    "honestly I'd be better off dead",
    "I CAN’T GO ON",
    "write suicide note",
    "overdose",
  ])("flags %j", (text) => {
    expect(hasDistressKeyword(text)).toBe(true);
  });

  it.each([
    "Book doctor's appointment",
    "Kill time before the train",
    "Run 5 kms",
    "Pick up my prescription",
    "Die-cut the stickers",
    "Watch Dead Poets Society",
    "Cut the grass",
    "Finish the killer sudoku",
  ])("leaves %j alone", (text) => {
    expect(hasDistressKeyword(text)).toBe(false);
  });

  it("matches whole words on normalised text and lists each phrase once", () => {
    expect(findDistressKeywords("Suicidal?  suicidal.")).toEqual(["suicidal"]);
    expect(hasDistressKeyword("antisuicidepolicy")).toBe(false);
    expect(hasDistressKeyword("want​ to die")).toBe(true);
  });
});

describe("KeywordPlusModelDetector", () => {
  const meter = { usage: { inputTokens: 150, outputTokens: 8, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, aborted: false };
  let deps: KeywordPlusModelDeps;
  let allowModelCheck: ReturnType<typeof vi.fn<(userId: string) => Promise<boolean>>>;
  let verdictCache: VerdictCache;
  let createMessage: ReturnType<typeof vi.fn>;
  let incrementUnavailableCounter: ReturnType<typeof vi.fn<() => Promise<void>>>;

  const reply = (text: string, overrides: Record<string, unknown> = {}): AiMessageResult =>
    ({ ok: true, message: message(text, overrides) as never, meter });

  beforeEach(() => {
    createMessage = vi.fn(async () => reply('{"risk":"none"}'));
    incrementUnavailableCounter = vi.fn<() => Promise<void>>(async () => undefined);
    allowModelCheck = vi.fn<(userId: string) => Promise<boolean>>(async () => true);
    verdictCache = new BoundedCache<"none">(5000, 86_400_000);
    deps = { isModelConfigured: () => true, createMessage: createMessage as never, incrementUnavailableCounter, allowModelCheck, verdictCache };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("answers high on a keyword hit without calling the model", async () => {
    const result = await new KeywordPlusModelDetector(deps).check("Clean room. I want to hurt myself", { userId: "u" });

    expect(result).toEqual({ risk: "high", source: "keyword" });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it.each(["none", "possible", "high"] as const)("returns the model's %s, with the call's usage for metering", async (risk) => {
    createMessage.mockResolvedValue(reply(JSON.stringify({ risk })));

    expect(await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" })).toEqual({ risk, source: "model", meter });
  });

  it("asks for a small structured answer with thinking off, inside the given slice", async () => {
    const signal = new AbortController().signal;
    await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u", timeoutMs: 1200, signal });

    const [params, options] = createMessage.mock.calls[0];
    expect(params).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 64, thinking: { type: "disabled" } });
    expect(params.output_config.format).toMatchObject({ type: "json_schema", schema: { properties: { risk: { enum: ["none", "possible", "high"] } } } });
    expect(params).not.toHaveProperty("temperature");
    expect(params.messages[0].content).toBe('To-do entry: "Sort laundry"');
    expect(options.signal).toBe(signal);
    expect(options.timeoutMs).toBeGreaterThan(1100);
    expect(options.timeoutMs).toBeLessThanOrEqual(1200);
    expect(allowModelCheck).toHaveBeenCalledWith("u");
  });

  it("skips the model with under 300 ms in its slice, counting the check as unavailable", async () => {
    const result = await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u", timeoutMs: 299 });

    expect(result).toMatchObject({ risk: "none", source: "unavailable" });
    expect(createMessage).not.toHaveBeenCalled();
    expect(allowModelCheck).not.toHaveBeenCalled();
    expect(incrementUnavailableCounter).toHaveBeenCalledTimes(1);
  });

  it("never gives the model more than 2.5 s", async () => {
    await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u", timeoutMs: 10_000 });

    expect(createMessage.mock.calls[0][1].timeoutMs).toBeLessThanOrEqual(2500);
  });

  it("fails closed on a refusal: the crisis card shows", async () => {
    createMessage.mockResolvedValue(reply("", { stop_reason: "refusal" }));

    expect(await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" })).toEqual({ risk: "possible", source: "model", meter });
    expect(incrementUnavailableCounter).not.toHaveBeenCalled();
  });

  describe("the per-instance cache of none verdicts", () => {
    it("reuses a none verdict for the same text in the same scope", async () => {
      const detector = new KeywordPlusModelDetector(deps);

      expect(await detector.check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-10-31" })).toMatchObject({ risk: "none", source: "model" });
      expect(await detector.check("  SORT   laundry ", { userId: "u", cacheScope: "task-1:2026-10-31" })).toEqual({ risk: "none", source: "model" });

      expect(createMessage).toHaveBeenCalledTimes(1);
      expect(verdictCache.size).toBe(1);
    });

    it("checks again for a new day, another task, or edited text", async () => {
      const detector = new KeywordPlusModelDetector(deps);
      await detector.check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });

      await detector.check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-11-01" });
      await detector.check("Sort laundry", { userId: "u", cacheScope: "task-2:2026-10-31" });
      await detector.check("Sort the laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });

      expect(createMessage).toHaveBeenCalledTimes(4);
    });

    it.each(["possible", "high"])("never caches %s", async (risk) => {
      createMessage.mockResolvedValue(reply(JSON.stringify({ risk })));
      const detector = new KeywordPlusModelDetector(deps);

      await detector.check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });
      await detector.check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });

      expect(createMessage).toHaveBeenCalledTimes(2);
      expect(verdictCache.size).toBe(0);
    });

    it("caches nothing without a scope, or when the check was unavailable", async () => {
      const detector = new KeywordPlusModelDetector(deps);
      await detector.check("Sort laundry", { userId: "u" });
      createMessage.mockResolvedValue(reply("maybe?"));
      await detector.check("Fold laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });

      expect(verdictCache.size).toBe(0);
    });

    it("keeps the task text out of its keys", async () => {
      await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u", cacheScope: "task-1:2026-10-31" });

      const keys = [...(verdictCache as unknown as { entries: Map<string, unknown> }).entries.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toMatch(/laundry|task-1/i);
    });
  });

  it("falls back to the keyword result once the user's daily model checks are used up", async () => {
    allowModelCheck.mockResolvedValue(false);

    const result = await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" });

    expect(result).toMatchObject({ risk: "none", source: "unavailable" });
    expect(createMessage).not.toHaveBeenCalled();
    expect(incrementUnavailableCounter).toHaveBeenCalledTimes(1);
  });

  it("still answers high on a keyword hit after the daily limit", async () => {
    allowModelCheck.mockResolvedValue(false);

    expect(await new KeywordPlusModelDetector(deps).check("I want to die", { userId: "u" })).toEqual({ risk: "high", source: "keyword" });
  });

  it.each([
    ["a failed call", (): AiMessageResult => ({ ok: false, reason: "timeout", meter: { ...meter, aborted: true } })],
    ["unreadable output", () => reply("maybe?")],
    ["a reply cut off at max_tokens", () => reply('{"risk":', { stop_reason: "max_tokens" })],
    ["an unknown risk value", () => reply('{"risk":"severe"}')],
  ])("lets the keyword result stand on %s, and counts it as unavailable", async (_name, outcome) => {
    createMessage.mockResolvedValue(outcome());

    const result = await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" });

    expect(result).toMatchObject({ risk: "none", source: "unavailable" });
    expect(result.meter).toBeDefined();
    expect(incrementUnavailableCounter).toHaveBeenCalledTimes(1);
    // The counter write is handed back rather than awaited, so it never delays the reaction.
    await expect(result.pendingWrites).resolves.toBeUndefined();
  });

  it("does not wait for the counter write before answering", async () => {
    createMessage.mockResolvedValue(reply("maybe?"));
    incrementUnavailableCounter.mockImplementation(() => new Promise(() => undefined));

    await expect(new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" })).resolves.toMatchObject({ source: "unavailable" });
  });

  it("skips the model call when there is no time left, and counts it as unavailable", async () => {
    const result = await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u", timeoutMs: 50 });

    expect(result).toMatchObject({ risk: "none", source: "unavailable" });
    expect(result.meter).toBeUndefined();
    expect(createMessage).not.toHaveBeenCalled();
    expect(incrementUnavailableCounter).toHaveBeenCalledTimes(1);
  });

  it("keeps the keyword result, with no counter, when no model is configured", async () => {
    deps.isModelConfigured = () => false;

    expect(await new KeywordPlusModelDetector(deps).check("Sort laundry", { userId: "u" })).toEqual({ risk: "none", source: "unavailable" });
    expect(createMessage).not.toHaveBeenCalled();
    expect(incrementUnavailableCounter).not.toHaveBeenCalled();
  });

  it("is what the factory builds", () => {
    expect(createDistressDetector(deps)).toBeInstanceOf(KeywordPlusModelDetector);
  });
});
