import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiEvent } from "@/lib/ai/anthropic";
import { isSpendLimitReached, readDailySpendLimitUsd, utcDate } from "@/lib/domain/ai-spend";
import type { Database } from "@/types";

// The global AI spend breaker (SPEC Phase 7 cost guardrail). With
// AI_DAILY_SPEND_LIMIT_USD set, once today's (UTC) estimated AI spend across
// all users reaches it, reactions use their prewritten line and splits answer
// split_unavailable until UTC midnight. The distress check never stops: safety
// does not depend on spend. The day's total is ai_spend_daily
// (20261031210000), which books every metered cost on the UTC day it was
// recorded; each server instance caches it for a minute, so the limit can be
// overshot by about a minute of traffic.

export const SPEND_CACHE_MS = 60_000;

type Admin = SupabaseClient<Database>;

let cached: { date: string; spendUsd: number; readAt: number } | null = null;
/** The read the "limit reached" warning was last logged for, so it logs once per read, not per request. */
let warnedForReadAt: number | null = null;

/** Test-only: forget the cached spend. */
export function resetSpendBreakerForTests() {
  cached = null;
  warnedForReadAt = null;
}

/** Today's (UTC) estimated AI spend in USD, at most SPEND_CACHE_MS old, or null when it can't be read. Never throws. */
export async function todaysAiSpendUsd(admin: Admin, now = new Date()): Promise<number | null> {
  const date = utcDate(now);
  if (cached && cached.date === date && now.getTime() - cached.readAt < SPEND_CACHE_MS) return cached.spendUsd;
  try {
    const { data, error } = await admin.from("ai_spend_daily").select("est_cost_usd").eq("date", date).maybeSingle();
    if (error) {
      logAiEvent("error", "ai_spend", { message: "daily spend unavailable", code: error.code ?? null });
      return null;
    }
    const spendUsd = Number(data?.est_cost_usd ?? 0);
    if (!Number.isFinite(spendUsd)) return null;
    cached = { date, spendUsd, readAt: now.getTime() };
    return spendUsd;
  } catch (error) {
    logAiEvent("error", "ai_spend", { message: "daily spend unavailable", error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Whether AI reactions and splits must stop for the rest of the UTC day.
 * Always false without AI_DAILY_SPEND_LIMIT_USD. Fails closed: when the
 * spend can't be read, AI is skipped (prewritten line, split_unavailable),
 * as when a cap reservation can't be made. Never throws.
 */
export async function isAiSpendLimitReached(admin: Admin, now = new Date()): Promise<boolean> {
  const limitUsd = readDailySpendLimitUsd();
  if (limitUsd === null) return false;
  const spendUsd = await todaysAiSpendUsd(admin, now);
  if (spendUsd === null) return true;
  const reached = isSpendLimitReached(spendUsd, limitUsd);
  if (reached && cached && warnedForReadAt !== cached.readAt) {
    warnedForReadAt = cached.readAt;
    logAiEvent("warn", "ai_spend", { message: "daily AI spend limit reached; AI reactions and splits paused until UTC midnight", spendUsd, limitUsd });
  }
  return reached;
}
