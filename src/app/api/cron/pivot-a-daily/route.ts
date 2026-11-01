import { readCostAlertPerPayingUserUsd, readDailySpendLimitUsd, isSpendLimitReached, isSpendNearLimit, utcDate } from "@/lib/domain/ai-spend";
import { readAiCaps } from "@/lib/domain/reaction-caps";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertPrivilegedRequest } from "@/lib/server/privileged";
import { assertDatabase, ok, withApi } from "@/lib/server/http";

// Room for every step, including Phase 8's purge, to run in one invocation.
export const maxDuration = 120;

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

const DAY_MS = 86_400_000;
const JOB = "pivot-a-daily";
const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

type Admin = ReturnType<typeof createAdminClient>;
type StepOutcome = { result: Record<string, unknown>; warnings: string[] };

/** Aggregates only: never a user id or any content. */
function log(level: "info" | "warn", alert: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, scope: "ai_cost", alert, ...fields });
  if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * The month-to-date AI cost report through `asOf`, and the cost alert:
 * AI_COST_ALERT_PER_PAYING_USER_USD (default 0.66, 15% of $4.42 net) against
 * the projected AI cost per paying user per month, or, while there are no
 * paying users (the free beta), against the AI cost per active user over the
 * last 30 days. Every run logs the basis used.
 */
async function costReportStep(admin: Admin, asOf: string): Promise<StepOutcome> {
  const caps = readAiCaps();
  const report = (assertDatabase(await admin.rpc("report_ai_cost", {
    p_month: asOf,
    p_as_of: asOf,
    p_plus_daily_reactions: caps.plusDailyReactions,
    p_plus_daily_splits: caps.plusDailySplits,
    p_free_weekly_reactions: caps.freeWeeklyReactions,
  })) ?? [])[0];
  if (!report) throw new Error("report_ai_cost returned no row");

  const alertThresholdUsd = readCostAlertPerPayingUserUsd();
  const payingUsers = Number(report.paying_users);
  const projectedPerPayingUser = nullableNumber(report.projected_cost_per_paying_user_usd);
  const perActiveUser30d = nullableNumber(report.cost_per_active_user_30d_usd);
  const alertBasis = payingUsers > 0 ? "paying_user" : "active_user_30d";
  const alertValueUsd = alertBasis === "paying_user" ? projectedPerPayingUser : perActiveUser30d;
  const warnings: string[] = [];

  const fields = {
    basis: alertBasis,
    valueUsd: alertValueUsd,
    thresholdUsd: alertThresholdUsd,
    month: report.month,
    asOf: report.as_of,
    payingUsers,
    activeUsers30d: Number(report.active_users_30d),
    betaFullAccess: report.beta_full_access,
  };
  if (alertValueUsd !== null && alertValueUsd > alertThresholdUsd) {
    warnings.push("cost_per_user");
    log("warn", "cost_per_user", {
      message: alertBasis === "paying_user"
        ? "Projected AI cost per paying user per month is above the alert threshold."
        : "No paying users: AI cost per active user over the last 30 days is above the alert threshold.",
      ...fields,
    });
  } else {
    log("info", "cost_per_user", { message: "AI cost per user is within the alert threshold.", ...fields });
  }

  return {
    warnings,
    result: {
      asOf: report.as_of,
      month: report.month,
      daysElapsed: report.days_elapsed,
      activeUsers: Number(report.active_users),
      payingUsers,
      totalCostUsd: Number(report.total_cost_usd),
      costPerPayingUserUsd: nullableNumber(report.cost_per_paying_user_usd),
      projectedCostPerPayingUserUsd: projectedPerPayingUser,
      costPerActiveUser30dUsd: perActiveUser30d,
      betaFullAccess: report.beta_full_access,
      alertBasis,
      alertValueUsd,
      alertThresholdUsd,
    },
  };
}

/** The UTC day's total AI spend (ai_spend_daily) against AI_DAILY_SPEND_LIMIT_USD; warns from 80%. */
async function dailySpendStep(admin: Admin, day: string): Promise<StepOutcome> {
  const spendUsd = Number(assertDatabase(await admin.from("ai_spend_daily").select("est_cost_usd").eq("date", day).maybeSingle())?.est_cost_usd ?? 0);
  const limitUsd = readDailySpendLimitUsd();
  const warnings: string[] = [];
  if (isSpendNearLimit(spendUsd, limitUsd)) {
    warnings.push("daily_spend_near_limit");
    log("warn", "daily_spend_near_limit", {
      message: "AI spend for the UTC day approached or reached the daily spend limit.",
      date: day,
      spendUsd,
      limitUsd,
      limitReached: isSpendLimitReached(spendUsd, limitUsd),
    });
  }
  return { warnings, result: { date: day, spendUsd, limitUsd } };
}

// The combined daily Pivot A job (one Vercel cron, see vercel.json), shortly
// after UTC midnight. Each step runs on its own: a failing step is logged and
// the others still run, and the job answers 500 only after all of them ran.
// Phase 8 adds the 30-day reaction purge as the FIRST step, independent of the
// analytics ones. The job is always on (not behind pivot_a), because that purge
// must keep running if Pivot A is switched off again.
//
// - ai_cost_report judges local dates through two days ago: ai_usage_daily is
//   keyed by users' local dates, and at 00:20 UTC yesterday is still running
//   for US users.
// - daily_spend judges yesterday on the UTC ledger, which is complete.
function run(request: Request) {
  return withApi(async () => {
    assertPrivilegedRequest(request);
    const admin = createAdminClient();
    const now = Date.now();
    const steps: Array<[name: string, step: () => Promise<StepOutcome>]> = [
      ["ai_cost_report", () => costReportStep(admin, utcDate(new Date(now - 2 * DAY_MS)))],
      ["daily_spend", () => dailySpendStep(admin, utcDate(new Date(now - DAY_MS)))],
    ];

    const results: Record<string, Record<string, unknown> | null> = {};
    const warnings: string[] = [];
    const failedSteps: string[] = [];
    for (const [name, step] of steps) {
      try {
        const outcome = await step();
        results[name] = outcome.result;
        warnings.push(...outcome.warnings);
      } catch (error) {
        results[name] = null;
        failedSteps.push(name);
        console.error(JSON.stringify({ level: "error", scope: "cron", job: JOB, step: name, message: error instanceof Error ? error.message : String(error) }));
      }
    }

    const summary = { steps: results, warnings, failedSteps };
    if (failedSteps.length > 0) {
      return Response.json({ data: summary, error: { code: "step_failed", message: `Daily steps failed: ${failedSteps.join(", ")}.` } }, { status: 500 });
    }
    return ok(summary);
  });
}
