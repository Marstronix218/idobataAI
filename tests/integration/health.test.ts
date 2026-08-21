import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, limit } = vi.hoisted(() => ({
  createClient: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/supabase/env", () => ({
  supabaseAnonKey: () => "test-anon-key",
  supabaseUrl: () => "https://example.supabase.co",
}));

import { GET } from "@/app/api/health/route";

describe("health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          abortSignal: vi.fn(() => ({ limit })),
        })),
      })),
    });
  });

  it("treats a completed database response as reachable even when RLS denies the probe", async () => {
    limit.mockResolvedValue({ status: 401, error: { message: "" } });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", database: "ok" });
  });

  it("reports the database unavailable when the request never receives an HTTP response", async () => {
    limit.mockResolvedValue({ status: 0, error: { message: "TypeError: fetch failed" } });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "degraded", database: "unavailable" });
  });
});
