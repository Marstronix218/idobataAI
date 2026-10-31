import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { ZERO_USAGE, estimateAbortedUsage, type TokenUsage } from "@/lib/domain/ai-cost";

// Pivot A's only model client (reactions, the distress check, the splitter).
// The legacy persona features keep their own provider in ./provider.ts.
//
// Haiku 5.5 rules that shape every request here (PLAN §6 item 3):
// - thinking is on by default and would eat a small max_tokens, so every
//   request sends `thinking: { type: "disabled" }` (allowed at the default
//   effort);
// - any temperature/top_p/top_k returns a 400, so none is sent;
// - no assistant prefill;
// - a refusal (`stop_reason: "refusal"`) has no server-side fallback, so
//   callers treat it as a failure;
// - the SDK's retries would multiply the deadline, so they are off.

export const AI_MODEL = "claude-haiku-5-5";
export const REACTION_MAX_TOKENS = 120;
export const DISTRESS_MAX_TOKENS = 64;
export const SPLIT_MAX_TOKENS = 200;
export const DEFAULT_REACTION_TIMEOUT_MS = 2500;
export const DEFAULT_SPLIT_TIMEOUT_MS = 5000;

type Env = Readonly<Record<string, string | undefined>>;

let client: Anthropic | null = null;

/** Built on first use, so a missing key never breaks module loading. */
export function getAnthropicClient(): Anthropic {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

/** Test-only: forget the client so the next call builds a new one. */
export function resetAnthropicClientForTests() {
  client = null;
}

/** An API key is set and the shared AI kill switch (AI_ENABLED=false) is off. */
export function isReactionAiConfigured(env: Env = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim()) && env.AI_ENABLED !== "false";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** AI_REACTION_TIMEOUT_MS, default 2500. Also bounds the distress check. */
export const reactionTimeoutMs = (env: Env = process.env) => positiveInt(env.AI_REACTION_TIMEOUT_MS, DEFAULT_REACTION_TIMEOUT_MS);
/** AI_SPLIT_TIMEOUT_MS, default 5000. */
export const splitTimeoutMs = (env: Env = process.env) => positiveInt(env.AI_SPLIT_TIMEOUT_MS, DEFAULT_SPLIT_TIMEOUT_MS);

export function readUsage(usage: Anthropic.Usage | null | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

/** The reply's text blocks joined; thinking and other blocks are ignored. */
export function messageText(message: Anthropic.Message): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
}

function textLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce<number>((sum, block) => sum + (block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text.length : 0), 0);
  }
  return 0;
}

/** Characters of prompt text in a request, for estimating an aborted call's input tokens. */
export function promptChars(params: Anthropic.MessageCreateParamsNonStreaming): number {
  return textLength(params.system) + params.messages.reduce((sum, message) => sum + textLength(message.content), 0);
}

export type AiFailureReason = "timeout" | "aborted" | "connection" | "api_error" | "unexpected";

/** What one model call cost, for ai_usage_daily. `aborted` calls count in `aborted_calls`. */
export interface AiCallMeter {
  usage: TokenUsage;
  aborted: boolean;
}

export type AiMessageResult =
  | { ok: true; message: Anthropic.Message; meter: AiCallMeter }
  | { ok: false; reason: AiFailureReason; status?: number; meter: AiCallMeter };

function failure(params: Anthropic.MessageCreateParamsNonStreaming, reason: AiFailureReason, status?: number): AiMessageResult {
  // No usage comes back. A call that may have reached the model is estimated;
  // an HTTP error response is not billed, so it is counted with no tokens.
  const usage = reason === "api_error" || reason === "unexpected"
    ? ZERO_USAGE
    : estimateAbortedUsage(promptChars(params), params.max_tokens);
  return { ok: false, reason, ...(status !== undefined && { status }), meter: { usage, aborted: true } };
}

/**
 * One Messages API call that settles by `timeoutMs` at the latest, whatever the
 * SDK does: the deadline aborts the request and resolves at once, even if the
 * HTTP promise never settles. Never throws; SDK errors become a typed failure
 * and are never shown to users.
 */
export async function createMessageWithin(
  params: Anthropic.MessageCreateParamsNonStreaming,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<AiMessageResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<"stopped">((resolve) => {
    if (controller.signal.aborted) return resolve("stopped");
    controller.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(0, timeoutMs));
  });

  try {
    if (controller.signal.aborted) return failure(params, "aborted");
    const request = getAnthropicClient().messages.create(params, { timeout: Math.max(1, timeoutMs), signal: controller.signal });
    // The abandoned request rejects once aborted; nobody is waiting for it.
    Promise.resolve(request).catch(() => undefined);
    const winner = await Promise.race([request, stopped]);
    if (winner === "stopped") return failure(params, timedOut ? "timeout" : "aborted");
    return { ok: true, message: winner, meter: { usage: readUsage(winner.usage), aborted: false } };
  } catch (error) {
    // Most specific first: the timeout and abort errors are subclasses.
    if (error instanceof Anthropic.APIConnectionTimeoutError) return failure(params, "timeout");
    if (error instanceof Anthropic.APIUserAbortError) return failure(params, timedOut ? "timeout" : "aborted");
    if (error instanceof Anthropic.APIConnectionError) return failure(params, "connection");
    if (error instanceof Anthropic.APIError) return failure(params, "api_error", error.status);
    return failure(params, "unexpected");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** One structured log line; never includes prompt or reply text. */
export function logAiEvent(level: "debug" | "warn" | "error", scope: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, scope, ...fields });
  if (level === "debug") console.debug(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}
