import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type DbError, type FakeSupabase, type Row } from "../helpers/fake-supabase";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET, POST, maxDuration } from "@/app/api/cron/pivot-a-daily/route";

const CRON_SECRET = "test-cron-secret";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let db: FakeSupabase;

/** report_ai_cost's row for October 2026 through the 30th; override what a test needs. */
const reportRow = (overrides: Row = {}): Row => ({
  month: "2026-10-01",
  as_of: "2026-10-30",
  days_elapsed: 30,
  days_in_month: 31,
  total_cost_usd: 1.4,
  active_users: 40,
  paying_users: 2,
  cost_per_active_user_usd: 0.035,
  active_users_30d: 45,
  cost_per_active_user_30d_usd: 0.04,
  cost_per_paying_user_usd: 0.2,
  projected_cost_per_paying_user_usd: 0.2,
  users_at_reaction_cap: 3,
  users_at_split_cap: 1,
  share_at_reaction_cap: 0.075,
  share_at_split_cap: 0.025,
  beta_full_access: false,
  ...overrides,
});

function useDatabase(row: Row, spend: Row[] = [], failures: { report?: DbError; spend?: DbError } = {}) {
  db = createFakeSupabase({ ai_spend_daily: spend }, {
    errors: failures.spend ? { ai_spend_daily: failures.spend } : undefined,
    rpc: (name) => (name === "report_ai_cost" ? (failures.report ? { data: null, error: failures.report } : { data: [row], error: null }) : undefined),
  });
  createAdminClient.mockReturnValue(db);
}

const request = (method = "GET", authorization: string | null = `Bearer ${CRON_SECRET}`) =>
  new Request("http://localhost/api/cron/pivot-a-daily", { method, headers: authorization ? { authorization } : {} });
const warnings = () => vi.mocked(console.warn).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
const infos = () => vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
const run = async (method = "GET") => {
  const response = await (method === "GET" ? GET : POST)(request(method));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Shortly after UTC midnight on 11-01.
  vi.setSystemTime(new Date("2026-11-01T00:20:00.000Z"));
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("WORKER_SECRET", "");
  vi.stubEnv("AI_COST_ALERT_PER_PAYING_USER_USD", "");
  vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "");
  vi.stubEnv("AI_CAP_PLUS_DAILY_REACTIONS", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useDatabase(reportRow());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/cron/pivot-a-daily", () => {
  it("refuses requests without the cron secret", async () => {
    for (const authorization of [null, "Bearer wrong", CRON_SECRET]) {
      const response = await GET(request("GET", authorization));
      expect(response.status).toBe(401);
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("answers 503 when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    expect((await GET(request())).status).toBe(503);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("allows two minutes, for every step including Phase 8's purge", () => {
    expect(maxDuration).toBe(120);
  });

  it("reports local dates through two days ago, judges yesterday's UTC spend, and returns a small summary", async () => {
    vi.stubEnv("AI_CAP_PLUS_DAILY_REACTIONS", "25");

    const { status, body } = await run();

    expect(status).toBe(200);
    // At 00:20 UTC, 10-31 is still running in US time zones; 10-30 is complete everywhere.
    expect(db.rpc).toHaveBeenCalledWith("report_ai_cost", {
      p_month: "2026-10-30",
      p_as_of: "2026-10-30",
      p_plus_daily_reactions: 25,
      p_plus_daily_splits: 10,
      p_free_weekly_reactions: 3,
    });
    expect(db.from).toHaveBeenCalledWith("ai_spend_daily");
    expect(db.from.mock.results[0].value.eq).toHaveBeenCalledWith("date", "2026-10-31");
    expect(body.data).toEqual({
      steps: {
        ai_cost_report: {
          asOf: "2026-10-30",
          month: "2026-10-01",
          daysElapsed: 30,
          activeUsers: 40,
          payingUsers: 2,
          totalCostUsd: 1.4,
          costPerPayingUserUsd: 0.2,
          projectedCostPerPayingUserUsd: 0.2,
          costPerActiveUser30dUsd: 0.04,
          betaFullAccess: false,
          alertBasis: "paying_user",
          alertValueUsd: 0.2,
          alertThresholdUsd: 0.66,
        },
        daily_spend: { date: "2026-10-31", spendUsd: 0, limitUsd: null },
      },
      warnings: [],
      failedSteps: [],
    });
    expect(console.warn).not.toHaveBeenCalled();
    // Every run logs the basis it judged.
    expect(infos()).toEqual([expect.objectContaining({ level: "info", scope: "ai_cost", alert: "cost_per_user", basis: "paying_user", valueUsd: 0.2, thresholdUsd: 0.66 })]);
  });

  it("reports the whole previous month on the 2nd of a month", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:20:00.000Z"));

    await run();

    expect(db.rpc).toHaveBeenCalledWith("report_ai_cost", expect.objectContaining({ p_month: "2026-10-31", p_as_of: "2026-10-31" }));
  });

  it("warns when the projected cost per paying user is above $0.66, with aggregates only", async () => {
    useDatabase(reportRow({ projected_cost_per_paying_user_usd: 0.661 }));

    const { status, body } = await run("POST");

    expect(status).toBe(200);
    expect(body.data.warnings).toEqual(["cost_per_user"]);
    expect(warnings()).toEqual([expect.objectContaining({
      level: "warn",
      scope: "ai_cost",
      alert: "cost_per_user",
      basis: "paying_user",
      valueUsd: 0.661,
      thresholdUsd: 0.66,
      payingUsers: 2,
    })]);
    expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).not.toMatch(UUID);
  });

  it.each([
    ["exactly at the threshold", 0.66],
    ["under it", 0.1],
  ])("does not warn %s", async (_name, projected) => {
    useDatabase(reportRow({ projected_cost_per_paying_user_usd: projected, cost_per_paying_user_usd: projected }));

    const { body } = await run();

    expect(body.data.warnings).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  describe("with no paying users (the free beta)", () => {
    const freeBeta = (perActiveUser: number | null) => reportRow({
      paying_users: 0,
      cost_per_paying_user_usd: null,
      projected_cost_per_paying_user_usd: null,
      cost_per_active_user_30d_usd: perActiveUser,
      beta_full_access: true,
    });

    it("applies the threshold to the cost per active user over 30 days, and says so", async () => {
      useDatabase(freeBeta(0.7));

      const { body } = await run();

      expect(body.data.steps.ai_cost_report).toMatchObject({ alertBasis: "active_user_30d", alertValueUsd: 0.7, betaFullAccess: true });
      expect(body.data.warnings).toEqual(["cost_per_user"]);
      expect(warnings()).toEqual([expect.objectContaining({ alert: "cost_per_user", basis: "active_user_30d", valueUsd: 0.7, thresholdUsd: 0.66, payingUsers: 0, activeUsers30d: 45, betaFullAccess: true })]);
      expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).not.toMatch(UUID);
    });

    it.each([["under the threshold", 0.5], ["with no active users either (null)", null]])("does not warn %s", async (_name, perActiveUser) => {
      useDatabase(freeBeta(perActiveUser));

      const { body } = await run();

      expect(body.data.steps.ai_cost_report).toMatchObject({ alertBasis: "active_user_30d", alertValueUsd: perActiveUser });
      expect(body.data.warnings).toEqual([]);
      expect(console.warn).not.toHaveBeenCalled();
      expect(infos()).toEqual([expect.objectContaining({ basis: "active_user_30d" })]);
    });
  });

  it("follows AI_COST_ALERT_PER_PAYING_USER_USD", async () => {
    vi.stubEnv("AI_COST_ALERT_PER_PAYING_USER_USD", "0.15");

    const { body } = await run();

    expect(body.data.steps.ai_cost_report.alertThresholdUsd).toBe(0.15);
    expect(body.data.warnings).toEqual(["cost_per_user"]);
  });

  it("warns when yesterday's total spend reached 80% of the daily limit", async () => {
    vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "10");
    useDatabase(reportRow(), [
      { date: "2026-10-31", est_cost_usd: 8.5 },
      { date: "2026-11-01", est_cost_usd: 50 },
    ]);

    const { body } = await run();

    expect(body.data.steps.daily_spend).toEqual({ date: "2026-10-31", spendUsd: 8.5, limitUsd: 10 });
    expect(body.data.warnings).toEqual(["daily_spend_near_limit"]);
    expect(warnings()).toEqual([expect.objectContaining({ alert: "daily_spend_near_limit", date: "2026-10-31", spendUsd: 8.5, limitUsd: 10, limitReached: false })]);
  });

  it("says when the limit was reached, and stays quiet under 80% or without a limit", async () => {
    vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "10");
    useDatabase(reportRow(), [{ date: "2026-10-31", est_cost_usd: 10 }]);
    await run();
    expect(warnings()).toEqual([expect.objectContaining({ alert: "daily_spend_near_limit", limitReached: true })]);

    vi.mocked(console.warn).mockClear();
    useDatabase(reportRow(), [{ date: "2026-10-31", est_cost_usd: 7.99 }]);
    await run();
    vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "");
    useDatabase(reportRow(), [{ date: "2026-10-31", est_cost_usd: 1_000 }]);
    await run();
    expect(console.warn).not.toHaveBeenCalled();
  });

  describe("independent steps", () => {
    it("still checks the spend when the cost report fails, then answers 500", async () => {
      vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "10");
      useDatabase(reportRow(), [{ date: "2026-10-31", est_cost_usd: 9 }], { report: { message: "statement timeout", code: "57014" } });

      const { status, body } = await run();

      expect(status).toBe(500);
      expect(body.error).toMatchObject({ code: "step_failed" });
      expect(body.data.failedSteps).toEqual(["ai_cost_report"]);
      expect(body.data.steps.ai_cost_report).toBeNull();
      expect(body.data.steps.daily_spend).toEqual({ date: "2026-10-31", spendUsd: 9, limitUsd: 10 });
      expect(warnings()).toEqual([expect.objectContaining({ alert: "daily_spend_near_limit" })]);
      const errors = vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(errors).toEqual([expect.objectContaining({ level: "error", scope: "cron", job: "pivot-a-daily", step: "ai_cost_report" })]);
    });

    it("still runs the cost report when the spend read fails", async () => {
      useDatabase(reportRow({ projected_cost_per_paying_user_usd: 0.9 }), [], { spend: { message: "connection reset", code: "08006" } });

      const { status, body } = await run();

      expect(status).toBe(500);
      expect(body.data.failedSteps).toEqual(["daily_spend"]);
      expect(body.data.steps.ai_cost_report).toMatchObject({ alertValueUsd: 0.9 });
      expect(body.data.warnings).toEqual(["cost_per_user"]);
    });

    it("answers 500 listing every failed step", async () => {
      useDatabase(reportRow(), [], { report: { message: "boom", code: "XX000" }, spend: { message: "boom", code: "XX000" } });

      const { status, body } = await run();

      expect(status).toBe(500);
      expect(body.data.failedSteps).toEqual(["ai_cost_report", "daily_spend"]);
    });
  });
});
