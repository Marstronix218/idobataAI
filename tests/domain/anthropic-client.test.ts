import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { Constructor, messagesCreate } = vi.hoisted(() => ({ Constructor: vi.fn(), messagesCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const FakeAnthropic = Object.assign(
    vi.fn(function FakeAnthropic(options: unknown) {
      Constructor(options);
      return { messages: { create: messagesCreate } };
    }),
    {
      APIError: actual.APIError,
      APIConnectionError: actual.APIConnectionError,
      APIConnectionTimeoutError: actual.APIConnectionTimeoutError,
      APIUserAbortError: actual.APIUserAbortError,
    },
  );
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import {
  createMessageWithin,
  getAnthropicClient,
  isReactionAiConfigured,
  messageText,
  reactionTimeoutMs,
  resetAnthropicClientForTests,
  splitTimeoutMs,
} from "@/lib/ai/anthropic";
import { message } from "../helpers/pivot-fixtures";

const params = {
  model: "claude-haiku-5-5",
  max_tokens: 120,
  system: "x".repeat(400),
  messages: [{ role: "user" as const, content: "y".repeat(400) }],
};

beforeEach(() => {
  resetAnthropicClientForTests();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the client", () => {
  it("is built once, on first use, with retries off and the key from the environment", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");

    getAnthropicClient();
    getAnthropicClient();

    expect(Constructor).toHaveBeenCalledTimes(1);
    expect(Constructor).toHaveBeenCalledWith({ apiKey: "test-placeholder", maxRetries: 0 });
  });

  it("counts as configured only with a key and the kill switch off", () => {
    expect(isReactionAiConfigured({})).toBe(false);
    expect(isReactionAiConfigured({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(isReactionAiConfigured({ ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(isReactionAiConfigured({ ANTHROPIC_API_KEY: "k", AI_ENABLED: "true" })).toBe(true);
    expect(isReactionAiConfigured({ ANTHROPIC_API_KEY: "k", AI_ENABLED: "false" })).toBe(false);
  });

  it("reads the deadlines, defaulting to 2.5 s and 5 s", () => {
    expect(reactionTimeoutMs({})).toBe(2500);
    expect(splitTimeoutMs({})).toBe(5000);
    expect(reactionTimeoutMs({ AI_REACTION_TIMEOUT_MS: "1800" })).toBe(1800);
    expect(reactionTimeoutMs({ AI_REACTION_TIMEOUT_MS: "-5" })).toBe(2500);
    expect(splitTimeoutMs({ AI_SPLIT_TIMEOUT_MS: "soon" })).toBe(5000);
  });

  it("reads only text blocks from a reply", () => {
    const reply = message("ignored", { content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: " Hi " }, { type: "text", text: "there" }] });
    expect(messageText(reply as unknown as Anthropic.Message)).toBe("Hi there");
  });
});

describe("createMessageWithin", () => {
  it("returns the reply and its usage, passing the deadline and an abort signal to the SDK", async () => {
    messagesCreate.mockResolvedValue(message("Hello", { usage: { ...message("").usage, input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 600, cache_creation_input_tokens: 5 } }));

    const result = await createMessageWithin(params, { timeoutMs: 2500 });

    expect(result).toMatchObject({ ok: true, meter: { aborted: false, usage: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 600, cacheCreationInputTokens: 5 } } });
    const [, options] = messagesCreate.mock.calls[0];
    expect(options.timeout).toBe(2500);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("settles at the deadline even if the SDK never does, aborting the request and estimating its cost", async () => {
    let signal: AbortSignal | undefined;
    messagesCreate.mockImplementation((_params: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return new Promise(() => undefined); });

    const pending = createMessageWithin(params, { timeoutMs: 2500 });
    await vi.advanceTimersByTimeAsync(2499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(signal?.aborted).toBe(true);
    expect(result).toEqual({ ok: false, reason: "timeout", meter: { aborted: true, usage: { inputTokens: 200, outputTokens: 120, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } } });
  });

  it("stops when the caller aborts", async () => {
    messagesCreate.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();

    const pending = createMessageWithin(params, { timeoutMs: 2500, signal: controller.signal });
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, reason: "aborted", meter: { aborted: true } });
  });

  it.each([
    ["a timeout error", () => new Anthropic.APIConnectionTimeoutError(), "timeout", 120],
    ["an abort error", () => new Anthropic.APIUserAbortError(), "aborted", 120],
    ["a connection error", () => new Anthropic.APIConnectionError({ message: "reset" }), "connection", 120],
    ["a 429", () => new Anthropic.APIError(429, { type: "error" }, "rate limited", new Headers()), "api_error", 0],
    ["a 400", () => new Anthropic.APIError(400, { type: "error" }, "bad request", new Headers()), "api_error", 0],
    ["anything else", () => new TypeError("boom"), "unexpected", 0],
  ])("turns %s into a typed failure and never throws", async (_name, error, reason, outputTokens) => {
    messagesCreate.mockRejectedValue(error());

    const result = await createMessageWithin(params, { timeoutMs: 2500 });

    expect(result).toMatchObject({ ok: false, reason, meter: { aborted: true, usage: { outputTokens } } });
  });

  it("keeps the HTTP status of an API error", async () => {
    messagesCreate.mockRejectedValue(new Anthropic.APIError(529, { type: "error" }, "overloaded", new Headers()));

    expect(await createMessageWithin(params, { timeoutMs: 2500 })).toMatchObject({ reason: "api_error", status: 529 });
  });
});
