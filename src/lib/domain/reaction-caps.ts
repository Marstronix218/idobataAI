// Which reactions and splits may use AI (SPEC Phase 3 step 2, PLAN D1/D2).
//
// - The `prewritten` experiment arm gets prewritten reactions on every plan.
// - Plus and trial: AI while today's AI reactions are under 30.
// - Free: AI while the AI reactions of the rolling 7 local days
//   [today-6, today] are under 3.
// - Splitting is Plus or trial only, up to 10 per local day.
//
// Days are the user's local dates, so every cap resets at local midnight.
//
// The caps are enforced atomically in the database: before any AI call the
// engine reserves a slot with reserve_ai_usage() using the window, cap and
// attempt ceiling from reactionReservation() / splitReservation(), and gives it
// back with release_ai_usage() when the AI result is not delivered (fallback,
// crisis, timeout, refusal, invalid output, a lost insert race). So only
// delivered AI reactions and splits use up the allowance, while the attempt
// ceiling (2x the cap; at least 10 on the free tier) bounds what failed
// attempts can cost.
//
// chooseReactionSource() and canSplit() are the same rules as pure functions
// over usage counts: the reference the SQL mirrors, and what the tests pin.

import type { AiArm } from "./ai-arm";
import { localDateRange } from "./local-day";
import type { PlanTier } from "./plan";

export type ReactionSource = "ai" | "prewritten";

export interface AiCaps {
  plusDailyReactions: number;
  plusDailySplits: number;
  freeWeeklyReactions: number;
}

export const DEFAULT_AI_CAPS: AiCaps = Object.freeze({
  plusDailyReactions: 30,
  plusDailySplits: 10,
  freeWeeklyReactions: 3,
});

/** The free allowance is counted over this many local days, today included. */
export const FREE_WINDOW_DAYS = 7;
/** Attempts (delivered or not) may reach this multiple of the cap before AI stops for the window. */
export const AI_ATTEMPT_CEILING_MULTIPLIER = 2;
/**
 * The free tier's attempt ceiling never drops below this. Its cap is only 3 a
 * week, so 2x would be 6 attempts: a short provider outage (every attempt
 * failing, so nothing delivered) could then end a free user's AI reactions
 * for the rest of the week. Plus and trial keep exactly 2x their daily cap.
 */
export const FREE_MIN_ATTEMPT_CEILING = 10;

/** The arguments for reserve_ai_usage(). */
export interface AiReservation {
  kind: "reaction" | "split";
  /** Local days counted, today included. */
  windowDays: number;
  /** Delivered results allowed in the window. */
  cap: number;
  /** Attempts allowed in the window, delivered or not. */
  attemptCeiling: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function nonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** AI_CAP_PLUS_DAILY_REACTIONS, AI_CAP_PLUS_DAILY_SPLITS, AI_CAP_FREE_WEEKLY_REACTIONS; invalid values use the defaults. */
export function readAiCaps(env: Env = process.env): AiCaps {
  return {
    plusDailyReactions: nonNegativeInt(env.AI_CAP_PLUS_DAILY_REACTIONS, DEFAULT_AI_CAPS.plusDailyReactions),
    plusDailySplits: nonNegativeInt(env.AI_CAP_PLUS_DAILY_SPLITS, DEFAULT_AI_CAPS.plusDailySplits),
    freeWeeklyReactions: nonNegativeInt(env.AI_CAP_FREE_WEEKLY_REACTIONS, DEFAULT_AI_CAPS.freeWeeklyReactions),
  };
}

export interface DailyAiUsage {
  /** AI reactions delivered that local day. */
  reactions: number;
  /** Splits delivered that local day. */
  splits: number;
}

/** ai_usage_daily rows keyed by local date (YYYY-MM-DD). A missing day means no usage. */
export type UsageByLocalDate = Readonly<Record<string, DailyAiUsage | undefined>>;

/** AI reactions delivered over the `days` local days ending at `today`. */
export function aiReactionsInWindow(usage: UsageByLocalDate, today: string, days: number): number {
  return localDateRange(today, days).reduce((sum, date) => sum + (usage[date]?.reactions ?? 0), 0);
}

export interface ReactionSourceInput {
  arm: AiArm;
  tier: PlanTier;
  /** An API key is set, the AI kill switch is off, and the character sheet can build a prompt. */
  aiConfigured: boolean;
  usageByLocalDate: UsageByLocalDate;
  /** The user's local date now. */
  today: string;
  caps?: AiCaps;
}

/**
 * The reservation an AI reaction needs, or null when this reaction is
 * prewritten whatever the usage: the `prewritten` arm (D1: every plan), or AI
 * not configured. Plus and trial: 30 a local day, 60 attempts. Free: 3 over 7
 * local days, max(2 x 3, 10) = 10 attempts.
 */
export function reactionReservation({ arm, tier, aiConfigured, caps = DEFAULT_AI_CAPS }: Omit<ReactionSourceInput, "usageByLocalDate" | "today">): AiReservation | null {
  if (arm === "prewritten" || !aiConfigured) return null;
  const paid = tier === "plus" || tier === "trial";
  const cap = paid ? caps.plusDailyReactions : caps.freeWeeklyReactions;
  const attemptCeiling = paid ? cap * AI_ATTEMPT_CEILING_MULTIPLIER : Math.max(cap * AI_ATTEMPT_CEILING_MULTIPLIER, FREE_MIN_ATTEMPT_CEILING);
  return { kind: "reaction", windowDays: paid ? 1 : FREE_WINDOW_DAYS, cap, attemptCeiling };
}

/** The same rules as reserve_ai_usage() for delivered reactions, over usage counts. */
export function chooseReactionSource({ usageByLocalDate, today, ...input }: ReactionSourceInput): ReactionSource {
  const reservation = reactionReservation(input);
  if (!reservation) return "prewritten";
  return aiReactionsInWindow(usageByLocalDate, today, reservation.windowDays) < reservation.cap ? "ai" : "prewritten";
}

export type SplitPlan = { ok: true; reservation: AiReservation } | { ok: false; reason: "plan_required" };

/**
 * D2: Plus or trial only, 10 a local day. The `ai_arm` experiment does not
 * apply: the arm is about reactions, and the splitter is a tool the user asks for.
 */
export function splitReservation({ tier, caps = DEFAULT_AI_CAPS }: { tier: PlanTier; caps?: AiCaps }): SplitPlan {
  if (tier === "free") return { ok: false, reason: "plan_required" };
  return {
    ok: true,
    reservation: { kind: "split", windowDays: 1, cap: caps.plusDailySplits, attemptCeiling: caps.plusDailySplits * AI_ATTEMPT_CEILING_MULTIPLIER },
  };
}

export type SplitDecision = { ok: true } | { ok: false; reason: "plan_required" | "split_cap_reached" };

/** The same rules as splitReservation() plus reserve_ai_usage(), over today's split count. */
export function canSplit({ tier, splitsToday, caps = DEFAULT_AI_CAPS }: { tier: PlanTier; splitsToday: number; caps?: AiCaps }): SplitDecision {
  const plan = splitReservation({ tier, caps });
  if (!plan.ok) return plan;
  return splitsToday < plan.reservation.cap ? { ok: true } : { ok: false, reason: "split_cap_reached" };
}
