import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COST_ALERT_PER_PAYING_USER_USD } from "@/lib/domain/ai-spend";
import { DEFAULT_AI_CAPS } from "@/lib/domain/reaction-caps";
import { resolvePivotFlags } from "../../scripts/lib/pivot-flags.mjs";
import {
  DEFAULT_CAPS,
  DEFAULT_COST_ALERT_USD,
  betaFullAccessInEffect,
  costAlertBasis,
  costAlertUsd,
  costReportParams,
  formatCostReport,
  formatExperimentReport,
  formatTable,
  parseReportArgs,
  readEnvFile,
} from "../../scripts/lib/report.mjs";

const HOST = "project-ref.supabase.co";
const noEnv = () => undefined;

const costRow = (overrides: Record<string, unknown> = {}) => ({
  month: "2026-10-01",
  as_of: "2026-10-15",
  days_elapsed: 15,
  days_in_month: 31,
  total_cost_usd: 0.42,
  active_users: 12,
  paying_users: 0,
  cost_per_active_user_usd: 0.035,
  active_users_30d: 14,
  cost_per_active_user_30d_usd: 0.05,
  cost_per_paying_user_usd: null,
  projected_cost_per_paying_user_usd: null,
  users_at_reaction_cap: 3,
  users_at_split_cap: 0,
  share_at_reaction_cap: 0.25,
  share_at_split_cap: 0,
  ...overrides,
});

describe("scripts/lib/report.mjs", () => {
  it("keeps its defaults identical to the app's", () => {
    expect(DEFAULT_COST_ALERT_USD).toBe(DEFAULT_COST_ALERT_PER_PAYING_USER_USD);
    expect(DEFAULT_CAPS).toEqual(DEFAULT_AI_CAPS);
  });

  describe("parseReportArgs", () => {
    it("reads the report, --json and --month", () => {
      expect(parseReportArgs(["experiment"])).toEqual({ report: "experiment", json: false, month: null });
      expect(parseReportArgs(["experiment", "--json"])).toEqual({ report: "experiment", json: true, month: null });
      expect(parseReportArgs(["cost"])).toEqual({ report: "cost", json: false, month: null });
      expect(parseReportArgs(["cost", "--month", "2026-02", "--json"])).toEqual({ report: "cost", json: true, month: "2026-02-01" });
      expect(parseReportArgs(["cost", "--month=2026-12"])).toEqual({ report: "cost", json: false, month: "2026-12-01" });
    });

    it.each([
      [[], /Unknown report ""/],
      [["costs"], /Unknown report "costs"/],
      [["cost", "--month"], /--month takes YYYY-MM/],
      [["cost", "--month", "2026-13"], /--month takes YYYY-MM/],
      [["cost", "--month", "26-01"], /--month takes YYYY-MM/],
      [["experiment", "--month", "2026-01"], /only applies to the cost report/],
      [["cost", "--csv"], /Unknown option "--csv"/],
    ])("rejects %j", (args, message) => {
      expect(() => parseReportArgs(args)).toThrow(message);
    });
  });

  describe("costReportParams and costAlertUsd", () => {
    it("pass the configured caps, falling back like readAiCaps", () => {
      expect(costReportParams(null, noEnv)).toEqual({ p_month: null, p_plus_daily_reactions: 30, p_plus_daily_splits: 10, p_free_weekly_reactions: 3 });
      const env = { AI_CAP_PLUS_DAILY_REACTIONS: "25", AI_CAP_PLUS_DAILY_SPLITS: "nope", AI_CAP_FREE_WEEKLY_REACTIONS: "2.5" } as Record<string, string>;
      expect(costReportParams("2026-02-01", (key) => env[key])).toEqual({ p_month: "2026-02-01", p_plus_daily_reactions: 25, p_plus_daily_splits: 10, p_free_weekly_reactions: 3 });
    });

    it("read the alert threshold, default 0.66", () => {
      expect(costAlertUsd(noEnv)).toBe(0.66);
      expect(costAlertUsd((key) => (key === "AI_COST_ALERT_PER_PAYING_USER_USD" ? "0.5" : undefined))).toBe(0.5);
      expect(costAlertUsd(() => "-1")).toBe(0.66);
    });
  });

  it("reads KEY=value env files, stripping quotes, and an absent file as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-env-"));
    try {
      const path = join(dir, ".env.local");
      writeFileSync(path, '# comment\nNEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"\nAI_CAP_PLUS_DAILY_SPLITS = 8\nnot a line\n');
      expect(readEnvFile(path)).toEqual(new Map([["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"], ["AI_CAP_PLUS_DAILY_SPLITS", "8"]]));
      expect(readEnvFile(join(dir, "missing"))).toEqual(new Map());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats a fixed-width table with labels left and numbers right", () => {
    expect(formatTable(["arm", "users"], [["ai", 3], ["prewritten", 12]])).toBe(
      ["arm         users", "ai              3", "prewritten     12"].join("\n"),
    );
    expect(formatTable(null, [["Total", "$1.0000"], ["Users", 4]], 2)).toBe(["Total  $1.0000", "Users  4"].join("\n"));
  });

  describe("formatExperimentReport", () => {
    it("says so when there are no Pivot A users", () => {
      expect(formatExperimentReport([], { host: HOST })).toBe(`ai_arm experiment on ${HOST}: no Pivot A users yet.`);
    });

    it("notes when beta full access was on, or when the flags could not be read", () => {
      const beta = formatExperimentReport([], { host: HOST, betaFullAccess: true });
      expect(beta).toContain("beta_full_access.enabled is on");
      expect(beta).toContain("beta testers show as free");
      expect(formatExperimentReport([], { host: HOST, betaFullAccess: null })).toContain("cannot say whether beta_full_access.enabled was on");
      expect(formatExperimentReport([], { host: HOST, betaFullAccess: false })).not.toContain("beta_full_access");
    });

    it("prints one row per arm and tier, with percentages and n/a", () => {
      const text = formatExperimentReport([
        { arm: "ai", plan_tier: "all", users: 2, tasks_finished: 8, tasks_finished_per_user_week: 0.99, day14_eligible_users: 1, day14_retained_users: 1, day14_retention: 1 },
        { arm: "ai", plan_tier: "plus", users: 1, tasks_finished: 2, tasks_finished_per_user_week: 1.27, day14_eligible_users: 0, day14_retained_users: 0, day14_retention: null },
      ], { host: HOST });

      const lines = text.split("\n");
      expect(lines[0]).toBe(`ai_arm experiment on ${HOST}`);
      expect(lines[2]).toMatch(/^arm\s+plan\s+users\s+finished\s+per user\/week\s+d14 eligible\s+d14 retained\s+d14 retention$/);
      expect(lines[3]).toMatch(/^ai\s+all\s+2\s+8\s+0\.99\s+1\s+1\s+100\.0%$/);
      expect(lines[4]).toMatch(/^ai\s+plus\s+1\s+2\s+1\.27\s+0\s+0\s+n\/a$/);
      expect(text).toContain("d14: of users whose local days 14-20 are over");
    });
  });

  describe("formatCostReport", () => {
    it("with no paying users, shows n/a per paying user and alerts on the 30-day cost per active user", () => {
      const text = formatCostReport(costRow(), { host: HOST, alertUsd: 0.66 });

      expect(text.split("\n")[0]).toBe(`AI cost for 2026-10 on ${HOST} (local dates 2026-10-01 to 2026-10-15, 15 of 31 days)`);
      expect(text).toMatch(/Total AI cost\s+\$0\.4200/);
      expect(text).toMatch(/Cost per active user, last 30 days\s+\$0\.0500 \(14 active users\)/);
      expect(text).toMatch(/Cost per paying user\s+n\/a \(no paying users\)/);
      expect(text).toMatch(/Projected per paying user \/ month\s+n\/a/);
      expect(text).toMatch(/Alert\s+cost per active user, last 30 days \(no paying users\) above \$0\.6600/);
      expect(text).toMatch(/Users at reaction cap\s+3 \(25\.0% of active\)/);
      expect(text).not.toContain("WARNING");

      expect(formatCostReport(costRow({ cost_per_active_user_30d_usd: 0.7 }), { host: HOST, alertUsd: 0.66 }))
        .toContain("WARNING: cost per active user, last 30 days (no paying users) ($0.7000) is above $0.6600.");
    });

    it("with paying users, warns when the projection is above the alert threshold, not at it", () => {
      const over = formatCostReport(costRow({ paying_users: 1, cost_per_paying_user_usd: 0.42, projected_cost_per_paying_user_usd: 0.868 }), { host: HOST, alertUsd: 0.66 });
      expect(over).toMatch(/Alert\s+projected cost per paying user \/ month above \$0\.6600/);
      expect(over).toContain("WARNING: projected cost per paying user / month ($0.8680) is above $0.6600.");

      const at = formatCostReport(costRow({ paying_users: 1, cost_per_paying_user_usd: 0.3, projected_cost_per_paying_user_usd: 0.66, cost_per_active_user_30d_usd: 9 }), { host: HOST, alertUsd: 0.66 });
      expect(at).not.toContain("WARNING");
    });

    it("notes the free beta", () => {
      const beta = formatCostReport(costRow(), { host: HOST, alertUsd: 0.66, betaFullAccess: true });
      expect(beta).toContain("beta_full_access.enabled is on");
      // Matches report_ai_cost, which judges everyone against the Plus caps while the beta is on.
      expect(beta).toContain("judge every user against the Plus daily caps");
      expect(beta).toContain("Beta access is not payment");
      expect(formatCostReport(costRow(), { host: HOST, alertUsd: 0.66 })).not.toContain("beta_full_access");
    });
  });

  describe("costAlertBasis and betaFullAccessInEffect", () => {
    it("pick the same basis as the daily cron", () => {
      expect(costAlertBasis(costRow())).toEqual({ basis: "active_user_30d", valueUsd: 0.05 });
      expect(costAlertBasis(costRow({ paying_users: 3, projected_cost_per_paying_user_usd: 0.2 }))).toEqual({ basis: "paying_user", valueUsd: 0.2 });
    });

    it("count beta full access only while Pivot A is on", () => {
      expect(betaFullAccessInEffect(resolvePivotFlags({ "pivot_a.enabled": true, "beta_full_access.enabled": true }))).toBe(true);
      expect(betaFullAccessInEffect(resolvePivotFlags({ "beta_full_access.enabled": true }))).toBe(false);
      expect(betaFullAccessInEffect(resolvePivotFlags({ "pivot_a.enabled": true }))).toBe(false);
      expect(betaFullAccessInEffect(null)).toBeNull();
    });
  });
});
