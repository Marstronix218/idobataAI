import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags, type PivotFlagKey } from "@/lib/domain/feature-flags";

const { after, createAdminClient, drainAIJobs, getFlags } = vi.hoisted(() => ({
  after: vi.fn(),
  createAdminClient: vi.fn(),
  drainAIJobs: vi.fn(),
  getFlags: vi.fn(),
}));

vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
// The worker route imports the barrel; drainAfterHumanEngagement is tested
// against the real worker module below.
vi.mock("@/lib/ai", () => ({ drainAIJobs }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after,
}));

import { GET as runCompanionCron } from "@/app/api/cron/companions/route";
import { GET as runWorker } from "@/app/api/workers/ai/route";
import { drainAfterHumanEngagement } from "@/lib/ai/worker";

const secret = "test-cron-secret";
const cronRequest = (path: string) => new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${secret}` } });

function useFlags(rows: Partial<Record<PivotFlagKey, boolean>>) {
  getFlags.mockResolvedValue(resolveFlags(rows));
}

describe("persona jobs under the Pivot A flags", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", secret);
    rpc.mockResolvedValue({ data: 3, error: null });
    createAdminClient.mockReturnValue({ rpc });
    drainAIJobs.mockResolvedValue([{ id: "job-1", status: "completed" }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("GET /api/cron/companions", () => {
    it("skips reconciliation when persona_autopost is off", async () => {
      useFlags({ "pivot_a.enabled": true });

      const response = await runCompanionCron(cronRequest("/api/cron/companions"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { skipped: "persona_autopost disabled" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("skips reconciliation when only persona_autopost is switched off", async () => {
      useFlags({ "persona_autopost.enabled": false });

      const response = await runCompanionCron(cronRequest("/api/cron/companions"));

      expect(await response.json()).toEqual({ data: { skipped: "persona_autopost disabled" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("reconciles as before with today's flags", async () => {
      useFlags({});

      const response = await runCompanionCron(cronRequest("/api/cron/companions"));

      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("reconcile_persona_engagements", { p_date: expect.any(String) });
      expect((await response.json()).data.planned).toBe(3);
    });

    it("still requires the cron credential before reading flags", async () => {
      useFlags({ "pivot_a.enabled": true });

      const response = await runCompanionCron(new Request("http://localhost/api/cron/companions"));

      expect(response.status).toBe(401);
      expect(getFlags).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/workers/ai", () => {
    it("drains nothing under Pivot A", async () => {
      useFlags({ "pivot_a.enabled": true });

      const response = await runWorker(cronRequest("/api/workers/ai"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { skipped: "persona_engagement disabled" } });
      expect(drainAIJobs).not.toHaveBeenCalled();
    });

    it("drains as before with today's flags", async () => {
      useFlags({});

      const response = await runWorker(cronRequest("/api/workers/ai?limit=10"));

      expect(await response.json()).toEqual({ data: { jobs: [{ id: "job-1", status: "completed" }] } });
      expect(drainAIJobs).toHaveBeenCalledWith(10);
    });
  });

  describe("drainAfterHumanEngagement", () => {
    async function runScheduledTask() {
      expect(after).toHaveBeenCalledTimes(1);
      await (after.mock.calls[0][0] as () => Promise<void>)();
    }

    it("leaves queued jobs alone under Pivot A", async () => {
      useFlags({ "pivot_a.enabled": true });

      drainAfterHumanEngagement();
      await runScheduledTask();

      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("claims jobs as before with today's flags", async () => {
      useFlags({});
      rpc.mockResolvedValue({ data: [], error: null });

      drainAfterHumanEngagement();
      await runScheduledTask();

      expect(rpc).toHaveBeenCalledWith("claim_ai_jobs", { p_limit: 2, p_lease_seconds: 120 });
    });
  });
});
