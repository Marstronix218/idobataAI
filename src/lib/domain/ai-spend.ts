// The AI cost guardrail (SPEC Phase 7). Pure helpers for the global daily spend
// breaker (src/lib/reactions/spend-breaker.ts) and the daily cost alert
// (src/app/api/cron/pivot-a-daily/route.ts).

type Env = Readonly<Record<string, string | undefined>>;

/** 15% of $4.42 net revenue per paying user per month (SPEC Phase 7). */
export const DEFAULT_COST_ALERT_PER_PAYING_USER_USD = 0.66;
/** The daily cron warns once a UTC day's spend reaches this share of the limit. */
export const SPEND_WARNING_RATIO = 0.8;

function nonNegativeNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** AI_DAILY_SPEND_LIMIT_USD in USD per UTC day; null (unset, empty or invalid) means no breaker. 0 stops AI entirely. */
export function readDailySpendLimitUsd(env: Env = process.env): number | null {
  return nonNegativeNumber(env.AI_DAILY_SPEND_LIMIT_USD);
}

/** AI_COST_ALERT_PER_PAYING_USER_USD, default 0.66; invalid values use the default. */
export function readCostAlertPerPayingUserUsd(env: Env = process.env): number {
  return nonNegativeNumber(env.AI_COST_ALERT_PER_PAYING_USER_USD) ?? DEFAULT_COST_ALERT_PER_PAYING_USER_USD;
}

/** True once the day's spend has reached the limit; never without a limit. */
export function isSpendLimitReached(spendUsd: number, limitUsd: number | null): boolean {
  return limitUsd !== null && spendUsd >= limitUsd;
}

/** True once the day's spend has reached SPEND_WARNING_RATIO of the limit; never without a limit. */
export function isSpendNearLimit(spendUsd: number, limitUsd: number | null): boolean {
  return limitUsd !== null && spendUsd >= limitUsd * SPEND_WARNING_RATIO;
}

/** The UTC date (YYYY-MM-DD) of `at`. */
export const utcDate = (at: Date) => at.toISOString().slice(0, 10);
