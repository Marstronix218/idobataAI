import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, rpc } = vi.hoisted(() => ({ authed: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  noContent: () => new Response(null, { status: 204 }),
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  withApi: async (handler: () => Promise<Response>) => {
    try { return await handler(); }
    catch (error) {
      const status = error instanceof Error && error.name === "ZodError"
        ? 422
        : typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
      return Response.json({ error: { message: error instanceof Error ? error.message : "error" } }, { status });
    }
  },
}));

import { DELETE, PUT } from "@/app/api/users/[userId]/follow/route";

describe("human profile following route", () => {
  const followedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: "following", error: null });
    authed.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      supabase: { rpc },
    });
  });

  it("follows a profile through the identity-safe database function", async () => {
    const response = await PUT(
      new Request(`http://localhost/api/users/${followedId}/follow`, { method: "PUT" }),
      { params: Promise.resolve({ userId: followedId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { state: "following", following: true } });
    expect(rpc).toHaveBeenCalledWith("set_user_follow", {
      p_followed_id: followedId,
      p_following: true,
    });
  });

  it("reports a protected profile as requested rather than followed", async () => {
    rpc.mockResolvedValue({ data: "requested", error: null });
    const response = await PUT(
      new Request(`http://localhost/api/users/${followedId}/follow`, { method: "PUT" }),
      { params: Promise.resolve({ userId: followedId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { state: "requested", following: false } });
  });

  it("unfollows a profile idempotently", async () => {
    rpc.mockResolvedValue({ data: "none", error: null });
    const response = await DELETE(
      new Request(`http://localhost/api/users/${followedId}/follow`, { method: "DELETE" }),
      { params: Promise.resolve({ userId: followedId }) },
    );

    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("set_user_follow", {
      p_followed_id: followedId,
      p_following: false,
    });
  });

  it("rejects malformed profile IDs before they reach Postgres", async () => {
    const response = await PUT(
      new Request("http://localhost/api/users/not-a-uuid/follow", { method: "PUT" }),
      { params: Promise.resolve({ userId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
