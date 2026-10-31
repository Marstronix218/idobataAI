import "server-only";

import { logAiEvent } from "@/lib/ai/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SafetyCounterKind } from "@/types";
import { BoundedCache, opaqueKey } from "./memory-cache";

/**
 * Adds one to today's (UTC) aggregate safety counter. No user id and no text
 * are ever passed or stored; California requires annual crisis-referral
 * reporting from July 2027. Never throws.
 */
export async function incrementSafetyCounter(kind: SafetyCounterKind): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("increment_safety_counter", { p_kind: kind });
    if (error) logAiEvent("error", "safety", { message: `${kind} counter failed`, code: error.code ?? null });
  } catch (error) {
    logAiEvent("error", "safety", { message: `${kind} counter failed`, error: error instanceof Error ? error.message : String(error) });
  }
}

/** A crisis card shown again for the same scope within this window is not counted again. */
export const CRISIS_DEDUPE_TTL_MS = 30 * 60_000;
/** At most this many crisis_card_shown increments per user per UTC day (per instance). */
export const CRISIS_COUNTS_PER_USER_DAY = 5;
const DAY_MS = 86_400_000;
const recentCrises = new BoundedCache<true>(10_000, CRISIS_DEDUPE_TTL_MS);
const crisesPerUserDay = new BoundedCache<number>(10_000, DAY_MS);

/**
 * Counts a crisis card in crisis_card_shown, once per `scope` (e.g. a task
 * event, or a task and local day for splits) within 30 minutes, and at most
 * five times per user per UTC day. The card itself is always shown; only the
 * aggregate count is bounded.
 *
 * The per-scope dedupe stops retries of the same start or split from
 * inflating the count; the per-user daily cap bounds deliberate inflation of
 * the SB 243 crisis-referral aggregate by one account creating many tasks.
 *
 * Limitation: both live in this server instance's memory only, keyed by
 * opaque HMACs. Requests that land on another instance, or after a restart,
 * are counted again, so the counter stays an upper bound. Nothing about the
 * user is stored.
 */
export async function recordCrisisShown(scope: string, userId: string): Promise<void> {
  const scopeKey = opaqueKey("crisis", scope);
  if (recentCrises.get(scopeKey)) return;
  recentCrises.set(scopeKey, true);

  const userDayKey = opaqueKey("crisis-user-day", userId, new Date().toISOString().slice(0, 10));
  const counted = crisesPerUserDay.get(userDayKey) ?? 0;
  if (counted >= CRISIS_COUNTS_PER_USER_DAY) return;
  crisesPerUserDay.set(userDayKey, counted + 1);
  await incrementSafetyCounter("crisis_card_shown");
}

/** At most this many distress_check_unavailable increments per user per UTC day (per instance). */
export const UNAVAILABLE_COUNTS_PER_USER_DAY = 5;
const unavailablePerUserDay = new BoundedCache<number>(10_000, DAY_MS);

/**
 * Counts a distress check whose model step was unavailable (PLAN D4) in
 * distress_check_unavailable, at most five times per user per UTC day, so one
 * account editing tasks past its `ai:distress` limit cannot inflate the
 * aggregate. Same per-instance limitation as recordCrisisShown; nothing about
 * the user is stored.
 */
export async function recordDistressCheckUnavailable(userId: string): Promise<void> {
  const userDayKey = opaqueKey("unavailable-user-day", userId, new Date().toISOString().slice(0, 10));
  const counted = unavailablePerUserDay.get(userDayKey) ?? 0;
  if (counted >= UNAVAILABLE_COUNTS_PER_USER_DAY) return;
  unavailablePerUserDay.set(userDayKey, counted + 1);
  await incrementSafetyCounter("distress_check_unavailable");
}

/** Test-only: forget which crises and unavailable checks were counted. */
export function resetCrisisDedupeForTests() {
  recentCrises.clear();
  crisesPerUserDay.clear();
  unavailablePerUserDay.clear();
}
