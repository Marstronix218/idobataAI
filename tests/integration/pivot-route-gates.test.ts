import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags, type PivotFlagKey } from "@/lib/domain/feature-flags";

const {
  authed,
  createAdminClient,
  drainAfterHumanEngagement,
  enforceRateLimit,
  getFlags,
  signPostMediaByPath,
  validateStoredPostMedia,
} = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  drainAfterHumanEngagement: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
  signPostMediaByPath: vi.fn(),
  validateStoredPostMedia: vi.fn(),
}));

// The real ApiError and withApi, so a closed gate answers exactly like any
// other missing resource.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/server/post-media", () => ({ signPostMediaByPath, validateStoredPostMedia, removePostMedia: vi.fn() }));
vi.mock("@/lib/ai", () => ({ drainAfterHumanEngagement }));

import { GET as getFeed } from "@/app/api/feed/route";
import { GET as listCompanions } from "@/app/api/companions/route";
import { GET as listThreads, POST as createThread } from "@/app/api/chat/route";
import { POST as sendMessage } from "@/app/api/chat/[id]/messages/route";
import { POST as publishWin } from "@/app/api/tasks/[id]/publish/route";

const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const companionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const threadId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const taskId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function useFlags(rows: Partial<Record<PivotFlagKey, boolean>>) {
  getFlags.mockResolvedValue(resolveFlags(rows));
}

/** A thenable PostgREST chain that records every filter. */
function queryChain(result: { data: unknown; error: null }) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result>;
  for (const method of ["select", "eq", "is", "not", "lte", "order", "limit", "or", "in", "range"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve) => Promise.resolve(result).then(resolve);
  chain.single = vi.fn(() => Promise.resolve(result));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  useFlags({});
  enforceRateLimit.mockResolvedValue(undefined);
  signPostMediaByPath.mockResolvedValue(new Map());
  createAdminClient.mockReturnValue({});
});

describe("GET /api/feed", () => {
  const humanPost = {
    id: "11111111-1111-4111-8111-111111111111",
    author_id: otherUserId,
    companion_id: null,
    kind: "human_completion",
    created_at: "2026-11-01T10:00:00.000Z",
    image_paths: [],
    quoted_post: null,
    social_reactions: [
      { id: "r1", reaction: "like", actor_id: userId, companion_id: null, reply_id: null },
      { id: "r2", reaction: "like", actor_id: null, companion_id: companionId, reply_id: null },
    ],
    social_reposts: [{ id: "p1", user_id: null, companion_id: companionId, created_at: "2026-11-01T10:05:00.000Z" }],
  };
  let posts: ReturnType<typeof queryChain>;
  const rpc = vi.fn();

  beforeEach(() => {
    posts = queryChain({ data: [humanPost], error: null });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        from: vi.fn((table: string) => table === "social_posts" ? posts : queryChain({ data: [], error: null })),
        rpc,
      },
    });
  });

  it("answers 404 when neither the feed nor sharing is on", async () => {
    useFlags({ "pivot_a.enabled": true, "share_win.enabled": false });

    const response = await getFeed(new Request("http://localhost/api/feed"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("serves only people's shared wins, without persona likes or reposts, when only sharing is on", async () => {
    useFlags({ "pivot_a.enabled": true });

    const response = await getFeed(new Request("http://localhost/api/feed?scope=following"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(posts.is).toHaveBeenCalledWith("companion_id", null);
    expect(posts.eq).toHaveBeenCalledWith("kind", "human_completion");
    expect(rpc).not.toHaveBeenCalled();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].social_reactions).toEqual([humanPost.social_reactions[0]]);
    expect(body.data.items[0].social_reposts).toEqual([]);
  });

  it("keeps the full feed, persona engagement included, with today's flags", async () => {
    const response = await getFeed(new Request("http://localhost/api/feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(posts.is).not.toHaveBeenCalledWith("companion_id", null);
    expect(posts.eq).not.toHaveBeenCalledWith("kind", "human_completion");
    expect(body.data.items[0].social_reactions).toHaveLength(2);
    expect(body.data.items[0].social_reposts).toHaveLength(1);
  });
});

describe("GET /api/companions", () => {
  it("answers 404 under Pivot A", async () => {
    useFlags({ "pivot_a.enabled": true });

    const response = await listCompanions(new Request("http://localhost/api/companions"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });
});

describe("/api/chat", () => {
  const rpc = vi.fn();
  const createThreadRequest = (body: object) => new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) });

  beforeEach(() => {
    rpc.mockResolvedValue({ data: { id: threadId }, error: null });
    authed.mockResolvedValue({ user: { id: userId }, supabase: { rpc, from: vi.fn(() => queryChain({ data: [], error: null })) } });
  });

  it("answers 404 for a persona thread under Pivot A", async () => {
    useFlags({ "pivot_a.enabled": true });

    const response = await createThread(createThreadRequest({ companionId }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still refuses a persona thread under Pivot A when the social feed is switched on", async () => {
    useFlags({ "pivot_a.enabled": true, "social_feed.enabled": true });

    const response = await createThread(createThreadRequest({ companionId }));

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("opens a human DM thread while the social feed is on", async () => {
    useFlags({ "pivot_a.enabled": true, "social_feed.enabled": true });

    const response = await createThread(createThreadRequest({ userId: otherUserId }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("get_or_create_chat_thread", { p_user_id: otherUserId, p_companion_id: null });
  });

  it("refuses a human DM thread while the social feed is off", async () => {
    useFlags({ "social_feed.enabled": false });

    const response = await createThread(createThreadRequest({ userId: otherUserId }));

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("thread list", () => {
    let threads: ReturnType<typeof queryChain>;

    beforeEach(() => {
      threads = queryChain({ data: [], error: null });
      authed.mockResolvedValue({ user: { id: userId }, supabase: { rpc, from: vi.fn(() => threads) } });
    });

    it("leaves persona threads out of the query, before the page limit, when persona chat is off", async () => {
      useFlags({ "pivot_a.enabled": true, "social_feed.enabled": true });

      const response = await listThreads(new Request("http://localhost/api/chat"));

      expect(response.status).toBe(200);
      expect(threads.is).toHaveBeenCalledWith("companion_id", null);
      expect(threads.not).not.toHaveBeenCalled();
      expect(threads.is.mock.invocationCallOrder[0]).toBeLessThan(threads.limit.mock.invocationCallOrder[0]);
    });

    it("leaves human DM threads out of the query when the social feed is off", async () => {
      useFlags({ "social_feed.enabled": false });

      await listThreads(new Request("http://localhost/api/chat"));

      expect(threads.not).toHaveBeenCalledWith("companion_id", "is", null);
      expect(threads.is).not.toHaveBeenCalled();
    });

    it("lists both kinds with today's flags", async () => {
      await listThreads(new Request("http://localhost/api/chat"));

      expect(threads.is).not.toHaveBeenCalled();
      expect(threads.not).not.toHaveBeenCalled();
    });
  });

  it("refuses a persona thread before spending rate-limit budget", async () => {
    useFlags({ "pivot_a.enabled": true, "social_feed.enabled": true });

    await createThread(createThreadRequest({ companionId }));

    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("answers 404 for a message to a persona thread under Pivot A without storing it", async () => {
    useFlags({ "pivot_a.enabled": true, "social_feed.enabled": true });
    const createMessage = vi.fn();
    createAdminClient.mockReturnValue({ rpc: createMessage });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: { from: vi.fn(() => queryChain({ data: { id: threadId, companion_id: companionId }, error: null })) },
    });

    const response = await sendMessage(new Request(`http://localhost/api/chat/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "hello", requestId: "99999999-9999-4999-8999-999999999999" }),
    }), { params: Promise.resolve({ id: threadId }) });

    expect(response.status).toBe(404);
    expect(createMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks/[id]/publish", () => {
  it("answers 404 when share_win is off, before anything is validated or written", async () => {
    useFlags({ "share_win.enabled": false });
    const rpc = vi.fn();
    authed.mockResolvedValue({ user: { id: userId }, supabase: { rpc } });

    const response = await publishWin(new Request(`http://localhost/api/tasks/${taskId}/publish`, {
      method: "POST",
      body: JSON.stringify({ visibility: "private" }),
    }), { params: Promise.resolve({ id: taskId }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(validateStoredPostMedia).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(drainAfterHumanEngagement).not.toHaveBeenCalled();
  });
});
