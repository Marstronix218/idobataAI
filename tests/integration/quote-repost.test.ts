import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, parseJson, rpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  parseJson: vi.fn(),
  rpc: vi.fn(),
}));

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
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

import { POST } from "@/app/api/posts/[id]/repost/route";
import { quoteRepostSchema } from "@/lib/server/schemas";

describe("quote repost route", () => {
  const sourcePostId = "11111111-1111-4111-8111-111111111111";
  const quote = {
    id: "22222222-2222-4222-8222-222222222222",
    author_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    quoted_post_id: sourcePostId,
    kind: "human_quote",
    content: "Worth remembering.",
    visibility: "public",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({ content: "Worth remembering.", visibility: "public", idempotencyKey: "quote-request-1" });
    rpc.mockResolvedValue({ data: quote, error: null });
    authed.mockResolvedValue({ supabase: { rpc } });
  });

  it("publishes validated commentary through the identity-safe quote RPC", async () => {
    const request = new Request(`http://localhost/api/posts/${sourcePostId}/repost`, {
      method: "POST",
      body: JSON.stringify({ content: "Worth remembering.", visibility: "public", idempotencyKey: "quote-request-1" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: sourcePostId }) });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: quote });
    expect(parseJson).toHaveBeenCalledWith(request, quoteRepostSchema);
    expect(rpc).toHaveBeenCalledWith("publish_quote_repost", {
      p_post_id: sourcePostId,
      p_content: "Worth remembering.",
      p_visibility: "public",
      p_idempotency_key: "quote-request-1",
    });
  });

  it("trims quote commentary and rejects blank or oversized input", () => {
    expect(quoteRepostSchema.parse({ content: "  Keep this  ", visibility: "private", idempotencyKey: " request-2 " })).toEqual({
      content: "Keep this",
      visibility: "private",
      idempotencyKey: "request-2",
    });
    expect(quoteRepostSchema.safeParse({ content: "   ", visibility: "public", idempotencyKey: "request-3" }).success).toBe(false);
    expect(quoteRepostSchema.safeParse({ content: "x".repeat(501), visibility: "public", idempotencyKey: "request-4" }).success).toBe(false);
  });
});
