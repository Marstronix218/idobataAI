import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, signPostMediaByPath } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  signPostMediaByPath: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  makeCursor: vi.fn(),
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseCursor: vi.fn(() => null),
  withApi: async (handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/server/post-media", () => ({ signPostMediaByPath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET } from "@/app/api/feed/route";

describe("Following feed", () => {
  const firstPostId = "11111111-1111-4111-8111-111111111111";
  const secondPostId = "22222222-2222-4222-8222-222222222222";
  let postQuery: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown[]; error: null }>;
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const chain = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown[]; error: null }>;
    for (const method of ["select", "eq", "is", "lte", "order", "limit", "or", "in"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
    postQuery = chain;

    const from = vi.fn((table: string) => table === "social_posts"
      ? postQuery
      : (() => { throw new Error(`Unexpected table: ${table}`); })());
    rpc.mockResolvedValue({
      data: [{ post_id: firstPostId, created_at: "2026-08-20T10:00:00.000Z" }, { post_id: secondPostId, created_at: "2026-08-20T09:00:00.000Z" }],
      error: null,
    });

    authed.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      supabase: { from, rpc },
    });
    createAdminClient.mockReturnValue({});
    signPostMediaByPath.mockResolvedValue(new Map());
  });

  it("uses the database-filtered relationship page without embedding every follow ID", async () => {
    const response = await GET(new Request("http://localhost/api/feed?scope=following"));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_following_post_ids", {
      p_category: null,
      p_before: null,
      p_before_id: null,
      p_limit: 21,
    });
    expect(postQuery.in).toHaveBeenCalledWith("id", [firstPostId, secondPostId]);
  });
});
