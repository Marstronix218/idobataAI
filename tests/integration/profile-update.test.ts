import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, parseJson, rateLimitRpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  parseJson: vi.fn(),
  rateLimitRpc: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
  assertDatabase: <T>(result: { data: T; error: { message: string; code?: string } | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => {
    try { return await handler(); }
    catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "internal_error";
      return Response.json({ error: { code, message: error instanceof Error ? error.message : "error" } }, { status });
    }
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { PATCH } from "@/app/api/profile/route";

describe("profile update route", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitRpc.mockResolvedValue({ data: true, error: null });
    createAdminClient.mockReturnValue({ rpc: rateLimitRpc });
    parseJson.mockResolvedValue({
      username: "mina_updated",
      displayName: "Mina Updated",
      bio: "Quiet progress.",
      avatarUrl: null,
      interests: ["Work"],
    });
    update.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: userId, username: "mina_updated" },
            error: null,
          }),
        })),
      })),
    });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: { from: vi.fn(() => ({ update })) },
    });
  });

  it("enforces the limit through the server client before updating through RLS", async () => {
    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ username: "mina_updated" }),
    }));

    expect(response.status).toBe(200);
    expect(rateLimitRpc).toHaveBeenCalledWith("check_rate_limit", {
      p_actor_key: userId,
      p_bucket: "profile:update",
      p_limit: 20,
      p_window_seconds: 3600,
    });
    expect(update).toHaveBeenCalledWith({
      username: "mina_updated",
      display_name: "Mina Updated",
      bio: "Quiet progress.",
      avatar_url: null,
      interests: ["Work"],
    });
  });
});
