import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, rpc } = vi.hoisted(() => ({ authed: vi.fn(), rpc: vi.fn() }));

// `@/lib/server/http` pulls in `server-only` through the bearer helper, so the
// module is stubbed rather than partially mocked -- the same shape the other
// route tests in this directory use.
vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson: async <T>(request: Request, schema: { parse: (value: unknown) => T }) => schema.parse(await request.json()),
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

import { GET, PUT } from "@/app/api/follow-requests/route";

describe("follow request route", () => {
  const requesterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeEach(() => {
    vi.clearAllMocks();
    authed.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, supabase: { rpc } });
  });

  it("lists the pending requests through the definer function", async () => {
    const requests = [{ requester_id: requesterId, username: "jonah", display_name: "Jonah", avatar_url: null, bio: null, created_at: "2026-08-27T00:00:00.000Z" }];
    rpc.mockResolvedValue({ data: requests, error: null });

    const response = await GET(new Request("http://localhost/api/follow-requests"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { requests } });
    expect(rpc).toHaveBeenCalledWith("get_follow_requests", { p_limit: 50 });
  });

  it("accepts a request and reports the resulting follow", async () => {
    rpc.mockResolvedValue({ data: "following", error: null });

    const response = await PUT(new Request("http://localhost/api/follow-requests", {
      method: "PUT",
      body: JSON.stringify({ requesterId, accept: true }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { state: "following" } });
    expect(rpc).toHaveBeenCalledWith("respond_follow_request", { p_requester_id: requesterId, p_accept: true });
  });

  it("declines a request without creating a follow edge", async () => {
    rpc.mockResolvedValue({ data: "none", error: null });

    const response = await PUT(new Request("http://localhost/api/follow-requests", {
      method: "PUT",
      body: JSON.stringify({ requesterId, accept: false }),
    }));

    expect(await response.json()).toEqual({ data: { state: "none" } });
    expect(rpc).toHaveBeenCalledWith("respond_follow_request", { p_requester_id: requesterId, p_accept: false });
  });

  it("rejects a malformed requester before it reaches Postgres", async () => {
    const response = await PUT(new Request("http://localhost/api/follow-requests", {
      method: "PUT",
      body: JSON.stringify({ requesterId: "not-a-uuid", accept: true }),
    }));

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
