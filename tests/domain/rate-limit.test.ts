import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, rpc } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
}));

import { enforceRateLimit } from "@/lib/server/rate-limit";

describe("enforceRateLimit", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClient.mockReturnValue({ rpc });
  });

  it("checks the verified actor through the server client", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await enforceRateLimit(userId, "profile:update", 20, 3600);

    expect(createAdminClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_actor_key: userId,
      p_bucket: "profile:update",
      p_limit: 20,
      p_window_seconds: 3600,
    });
  });

  it("returns a rate-limit error when the check refuses the request", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    await expect(enforceRateLimit(userId, "profile:update", 20, 3600)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("fails closed when the check is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(enforceRateLimit(userId, "profile:update", 20, 3600)).rejects.toMatchObject({
      status: 503,
      code: "rate_limit_unavailable",
    });
  });
});
