import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiEvent, type AiCallMeter } from "@/lib/ai/anthropic";
import { ZERO_USAGE, addUsage, estCostUsd, readAiPrices, roundUsd } from "@/lib/domain/ai-cost";
import type { AiReservation } from "@/lib/domain/reaction-caps";
import type { Database } from "@/types";

type Admin = SupabaseClient<Database>;

export interface UsageIncrement {
  /** Distress model checks made; never capped. */
  safetyChecks?: number;
  /** Every model call made, delivered or not. */
  calls: ReadonlyArray<AiCallMeter | null | undefined>;
}

/**
 * Adds one request's AI calls to the user's ai_usage_daily row for their local
 * `date` through record_ai_usage(): tokens, estimated cost, safety checks and
 * aborted calls (with estimated tokens). Delivered reactions and splits are
 * counted by reserve_ai_usage() instead, so p_reactions and p_splits are 0.
 * Never throws: metering must not take a reaction away.
 */
export async function recordAiUsage(admin: Admin, userId: string, date: string, increment: UsageIncrement): Promise<void> {
  const calls = increment.calls.filter((call): call is AiCallMeter => Boolean(call));
  if (calls.length === 0 && !increment.safetyChecks) return;
  const usage = calls.reduce((sum, call) => addUsage(sum, call.usage), ZERO_USAGE);
  const prices = readAiPrices();
  const cost = calls.reduce((sum, call) => sum + estCostUsd(call.usage, prices), 0);
  try {
    const { error } = await admin.rpc("record_ai_usage", {
      p_user_id: userId,
      p_date: date,
      p_reactions: 0,
      p_splits: 0,
      p_safety_checks: increment.safetyChecks ?? 0,
      p_aborted_calls: calls.filter((call) => call.aborted).length,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cache_read: usage.cacheReadInputTokens,
      p_cache_creation: usage.cacheCreationInputTokens,
      p_cost: roundUsd(cost),
    });
    if (error) logAiEvent("error", "ai_usage", { message: "record_ai_usage failed", code: error.code ?? null });
  } catch (error) {
    logAiEvent("error", "ai_usage", { message: "record_ai_usage failed", error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Atomically takes one delivered slot (and one attempt) in the user's window,
 * if the cap and the attempt ceiling allow it. True when reserved, false when
 * the cap or ceiling is reached, null when the reservation could not be made
 * (no reservation means no AI call either way).
 */
export async function reserveAiUsage(admin: Admin, userId: string, date: string, reservation: AiReservation): Promise<boolean | null> {
  try {
    const { data, error } = await admin.rpc("reserve_ai_usage", {
      p_user_id: userId,
      p_kind: reservation.kind,
      p_date: date,
      p_window_days: reservation.windowDays,
      p_cap: reservation.cap,
      p_attempt_ceiling: reservation.attemptCeiling,
    });
    if (error) {
      logAiEvent("error", "ai_usage", { message: "reserve_ai_usage failed", code: error.code ?? null });
      return null;
    }
    return data === true;
  } catch (error) {
    logAiEvent("error", "ai_usage", { message: "reserve_ai_usage failed", error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Gives back a reserved slot whose AI result was not delivered (the attempt stays counted). Never throws. */
export async function releaseAiUsage(admin: Admin, userId: string, date: string, kind: AiReservation["kind"]): Promise<void> {
  try {
    const { error } = await admin.rpc("release_ai_usage", { p_user_id: userId, p_kind: kind, p_date: date });
    if (error) logAiEvent("error", "ai_usage", { message: "release_ai_usage failed", code: error.code ?? null });
  } catch (error) {
    logAiEvent("error", "ai_usage", { message: "release_ai_usage failed", error: error instanceof Error ? error.message : String(error) });
  }
}
