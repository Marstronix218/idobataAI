// Pure helpers for `npm run report:experiment` and `npm run report:cost`
// (scripts/report.mjs): argument parsing, env-file reading and plain-text
// tables, so tests/domain/report-script.test.ts can run them without a
// database. The definitions behind the numbers live with report_ai_arm and
// report_ai_cost in supabase/migrations/20261031210000_pivot_a_metrics.sql.

import { existsSync, readFileSync } from "node:fs";

export const REPORTS = ["experiment", "cost"];
/** Same default as DEFAULT_COST_ALERT_PER_PAYING_USER_USD in src/lib/domain/ai-spend.ts. */
export const DEFAULT_COST_ALERT_USD = 0.66;
/** Same defaults as DEFAULT_AI_CAPS in src/lib/domain/reaction-caps.ts. */
export const DEFAULT_CAPS = { plusDailyReactions: 30, plusDailySplits: 10, freeWeeklyReactions: 3 };

const USAGE = "Use: report experiment [--json] | report cost [--month YYYY-MM] [--json].";

/**
 * @param {string[]} args the arguments after `node scripts/report.mjs`
 * @returns {{ report: "experiment" | "cost"; json: boolean; month: string | null }} month is the first day, YYYY-MM-01
 */
export function parseReportArgs(args) {
  const [report, ...rest] = args;
  if (!REPORTS.includes(report)) throw new Error(`Unknown report "${report ?? ""}". ${USAGE}`);
  let json = false;
  let month = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--month" || arg.startsWith("--month=")) {
      if (report !== "cost") throw new Error(`--month only applies to the cost report. ${USAGE}`);
      const value = arg === "--month" ? rest[(index += 1)] : arg.slice("--month=".length);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "")) throw new Error(`--month takes YYYY-MM, got "${value ?? ""}".`);
      month = `${value}-01`;
    } else {
      throw new Error(`Unknown option "${arg}". ${USAGE}`);
    }
  }
  return { report, json, month };
}

/**
 * KEY=value lines of an env file (quotes stripped); an empty map when it is missing.
 * @param {string} path
 * @returns {Map<string, string>}
 */
export function readEnvFile(path) {
  if (!existsSync(path)) return new Map();
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

function nonNegative(value, fallback, integer) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && (!integer || Number.isInteger(parsed)) ? parsed : fallback;
}

/**
 * The report_ai_cost arguments: the month (null = current UTC month) and the
 * configured AI_CAP_* values, read like readAiCaps() does.
 * @param {string | null} month
 * @param {(key: string) => string | undefined} env
 */
export function costReportParams(month, env) {
  return {
    p_month: month,
    p_plus_daily_reactions: nonNegative(env("AI_CAP_PLUS_DAILY_REACTIONS"), DEFAULT_CAPS.plusDailyReactions, true),
    p_plus_daily_splits: nonNegative(env("AI_CAP_PLUS_DAILY_SPLITS"), DEFAULT_CAPS.plusDailySplits, true),
    p_free_weekly_reactions: nonNegative(env("AI_CAP_FREE_WEEKLY_REACTIONS"), DEFAULT_CAPS.freeWeeklyReactions, true),
  };
}

/** AI_COST_ALERT_PER_PAYING_USER_USD, default 0.66. @param {(key: string) => string | undefined} env */
export function costAlertUsd(env) {
  return nonNegative(env("AI_COST_ALERT_PER_PAYING_USER_USD"), DEFAULT_COST_ALERT_USD, false);
}

const present = (value) => value !== null && value !== undefined;
export const formatUsd = (value) => (present(value) ? `$${Number(value).toFixed(4)}` : "n/a");
export const formatPercent = (value) => (present(value) ? `${(Number(value) * 100).toFixed(1)}%` : "n/a");
const formatNumber = (value) => (present(value) ? Number(value).toFixed(2) : "n/a");

const BETA_NOTES = {
  experiment: "Note: beta_full_access.enabled is on, so every user has Plus-level access (AI caps, splits, every chapter). Plan tiers here come from entitlements, so beta testers show as free; the arms still differ only by ai_arm.",
  cost: "Note: beta_full_access.enabled is on: everyone has the Plus AI caps, so the cap counts above judge every user against the Plus daily caps. Beta access is not payment, so with no paying users the alert applies to the cost per active user over the last 30 days.",
  unknown: "Note: the flags could not be read, so this report cannot say whether beta_full_access.enabled was on.",
};

/**
 * Whether the free beta's full access is in effect (Pivot A and
 * beta_full_access.enabled both on), from the resolved flags; null when they
 * could not be read.
 * @param {Record<string, boolean> | null} flags resolvePivotFlags() output
 */
export function betaFullAccessInEffect(flags) {
  if (!flags) return null;
  return Boolean(flags["pivot_a.enabled"] && flags["beta_full_access.enabled"]);
}

function betaNote(kind, betaFullAccess) {
  if (betaFullAccess === null || betaFullAccess === undefined) return [BETA_NOTES.unknown];
  return betaFullAccess ? [BETA_NOTES[kind]] : [];
}

/**
 * What the cost alert is judged on, as the daily cron does: the projected cost
 * per paying user, or with no paying users the cost per active user over the
 * last 30 days.
 * @param {Record<string, unknown>} row
 */
export function costAlertBasis(row) {
  return Number(row.paying_users) > 0
    ? { basis: "paying_user", valueUsd: row.projected_cost_per_paying_user_usd ?? null }
    : { basis: "active_user_30d", valueUsd: row.cost_per_active_user_30d_usd ?? null };
}

/**
 * A plain fixed-width table. The first `leftColumns` columns are left-aligned
 * (labels), the rest right-aligned (numbers). `headers` null: no header row.
 * @param {string[] | null} headers
 * @param {Array<Array<string | number>>} rows
 */
export function formatTable(headers, rows, leftColumns = 1) {
  const cells = (headers ? [headers, ...rows] : rows).map((row) => row.map((cell) => String(cell)));
  const widths = cells[0].map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  return cells
    .map((row) => row.map((cell, column) => (column < leftColumns ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ").trimEnd())
    .join("\n");
}

/**
 * report_ai_arm rows as text.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ host: string; betaFullAccess?: boolean | null }} context
 */
export function formatExperimentReport(rows, { host, betaFullAccess = false }) {
  const title = `ai_arm experiment on ${host}`;
  if (rows.length === 0) return [`${title}: no Pivot A users yet.`, ...betaNote("experiment", betaFullAccess)].join("\n");
  const table = formatTable(
    ["arm", "plan", "users", "finished", "per user/week", "d14 eligible", "d14 retained", "d14 retention"],
    rows.map((row) => [
      row.arm, row.plan_tier, row.users, row.tasks_finished, formatNumber(row.tasks_finished_per_user_week),
      row.day14_eligible_users, row.day14_retained_users, formatPercent(row.day14_retention),
    ]),
    2,
  );
  return [
    title,
    "",
    table,
    "",
    "plan: the plan now; \"all\" is the whole arm.",
    "per user/week: finished tasks since day 0 (first Pivot A activity, local date) x 7 / days since (at least 7), averaged per user.",
    "d14: of users whose local days 14-20 are over, the share with a task event or app session on those days.",
    ...betaNote("experiment", betaFullAccess).flatMap((note) => ["", note]),
  ].join("\n");
}

/**
 * The report_ai_cost row as text.
 * @param {Record<string, unknown>} row
 * @param {{ host: string; alertUsd: number; betaFullAccess?: boolean | null }} context
 */
export function formatCostReport(row, { host, alertUsd, betaFullAccess = false }) {
  const month = String(row.month).slice(0, 7);
  const payingNote = Number(row.paying_users) === 0 ? " (no paying users)" : "";
  const projected = row.projected_cost_per_paying_user_usd;
  const alert = costAlertBasis(row);
  const basisLabel = alert.basis === "paying_user" ? "projected cost per paying user / month" : "cost per active user, last 30 days (no paying users)";
  const lines = [
    `AI cost for ${month} on ${host} (local dates ${row.month} to ${row.as_of}, ${row.days_elapsed} of ${row.days_in_month} days)`,
    "",
    formatTable(null, [
      ["Total AI cost", formatUsd(row.total_cost_usd)],
      ["Active users", row.active_users],
      ["Paying users", row.paying_users],
      ["Cost per active user", formatUsd(row.cost_per_active_user_usd)],
      ["Cost per active user, last 30 days", `${formatUsd(row.cost_per_active_user_30d_usd)} (${row.active_users_30d ?? 0} active users)`],
      ["Cost per paying user", `${formatUsd(row.cost_per_paying_user_usd)}${payingNote}`],
      ["Projected per paying user / month", formatUsd(projected)],
      ["Alert", `${basisLabel} above ${formatUsd(alertUsd)}`],
      ["Users at reaction cap", `${row.users_at_reaction_cap} (${formatPercent(row.share_at_reaction_cap)} of active)`],
      ["Users at split cap", `${row.users_at_split_cap} (${formatPercent(row.share_at_split_cap)} of active)`],
    ], 2).split("\n").map((line) => `  ${line}`).join("\n"),
    "",
    "Cost per paying user is ALL AI cost (free users' too) divided by paying users (active Plus now, or an active pack; trials do not pay).",
    ...betaNote("cost", betaFullAccess).flatMap((note) => ["", note]),
  ];
  if (present(alert.valueUsd) && Number(alert.valueUsd) > alertUsd) {
    lines.push("", `WARNING: ${basisLabel} (${formatUsd(alert.valueUsd)}) is above ${formatUsd(alertUsd)}.`);
  }
  return lines.join("\n");
}
