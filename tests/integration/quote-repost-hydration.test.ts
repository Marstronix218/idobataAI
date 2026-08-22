import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authed,
  createAdminClient,
  loadThreadReplies,
  signPostMediaByPath,
} = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  loadThreadReplies: vi.fn(),
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
vi.mock("@/lib/server/reply-thread", () => ({ loadThreadReplies }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET as getFeed } from "@/app/api/feed/route";
import { GET as getPost } from "@/app/api/posts/[id]/route";

const postId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const originalPath = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/pending/original.jpg";
const quotedPath = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pending/quoted.jpg";

function quotePost() {
  return {
    id: postId,
    created_at: "2026-08-21T12:00:00.000Z",
    image_paths: [originalPath],
    social_reactions: [],
    social_reposts: [],
    quoted_post: {
      id: quoteId,
      image_paths: [quotedPath],
      user_profiles: { username: "source", display_name: "Source", avatar_url: null },
      social_companions: null,
    },
  };
}

describe("quote repost API hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClient.mockReturnValue({ storage: "admin-client" });
    loadThreadReplies.mockResolvedValue([]);
    signPostMediaByPath.mockResolvedValue(new Map([
      [originalPath, "https://signed.example/original.jpg"],
      [quotedPath, "https://signed.example/quoted.jpg"],
    ]));
  });

  it("hydrates and signs the quoted post returned by GET /api/feed", async () => {
    const select = vi.fn();
    const query = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown[]; error: null }>;
    for (const method of ["eq", "is", "lte", "order", "limit", "or", "in"]) {
      query[method] = vi.fn(() => query);
    }
    query.then = (resolve) => Promise.resolve({ data: [quotePost()], error: null }).then(resolve);
    select.mockReturnValue(query);
    authed.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      supabase: { from: vi.fn(() => ({ select })) },
    });

    const response = await getFeed(new Request("http://localhost/api/feed?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(select.mock.calls[0][0]).toContain(
      "quoted_post(",
    );
    expect(signPostMediaByPath).toHaveBeenCalledWith(
      { storage: "admin-client" },
      [originalPath, quotedPath],
    );
    expect(body.data.items[0].image_urls).toEqual(["https://signed.example/original.jpg"]);
    expect(body.data.items[0].quoted_post).toMatchObject({
      id: quoteId,
      image_urls: ["https://signed.example/quoted.jpg"],
    });
  });

  it("hydrates and signs the quoted post returned by GET /api/posts/[id]", async () => {
    const select = vi.fn();
    const single = vi.fn().mockResolvedValue({ data: quotePost(), error: null });
    const secondEq = vi.fn(() => ({ single }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    select.mockReturnValue({ eq: firstEq });
    authed.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      supabase: { from: vi.fn(() => ({ select })) },
    });

    const response = await getPost(
      new Request(`http://localhost/api/posts/${postId}`),
      { params: Promise.resolve({ id: postId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(select.mock.calls[0][0]).toContain(
      "quoted_post(",
    );
    expect(signPostMediaByPath).toHaveBeenCalledWith(
      { storage: "admin-client" },
      [originalPath, quotedPath],
    );
    expect(body.data.image_urls).toEqual(["https://signed.example/original.jpg"]);
    expect(body.data.quoted_post).toMatchObject({
      id: quoteId,
      image_urls: ["https://signed.example/quoted.jpg"],
    });
  });
});
