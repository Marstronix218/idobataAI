import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authed,
  createAdminClient,
  drainAfterHumanEngagement,
  getFlags,
  parseJson,
  removePostMedia,
  update,
  validateStoredPostMedia,
} = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  drainAfterHumanEngagement: vi.fn(),
  getFlags: vi.fn(),
  parseJson: vi.fn(),
  removePostMedia: vi.fn(),
  update: vi.fn(),
  validateStoredPostMedia: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ drainAfterHumanEngagement }));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T>(result: { data: T; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/server/post-media", () => ({ removePostMedia, validateStoredPostMedia }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { POST } from "@/app/api/tasks/[id]/publish/route";
import { LEGACY_FLAGS, resolveFlags } from "@/lib/domain/feature-flags";

describe("completion publishing", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const taskId = "aaaaaaaa-0000-4000-8000-000000000001";
  const post = {
    id: "aaaaaaaa-1000-4000-8000-000000000001",
    author_id: userId,
    visibility: "private",
    image_paths: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getFlags.mockResolvedValue(LEGACY_FLAGS);
    parseJson.mockResolvedValue({ message: "Done.", visibility: "private", imagePaths: [] });
    validateStoredPostMedia.mockResolvedValue(undefined);
    removePostMedia.mockResolvedValue(true);

    const single = vi.fn().mockResolvedValue({ data: post, error: null });
    const select = vi.fn(() => ({ single }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    update.mockImplementation(() => ({ eq: firstEq }));
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ update })),
    });

    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        rpc: vi.fn().mockResolvedValue({ data: post, error: null }),
      },
    });
  });

  it("starts the priority persona drain after a private completion is stored", async () => {
    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/publish`, {
      method: "POST",
      body: JSON.stringify({ message: "Done.", visibility: "private" }),
    }), { params: Promise.resolve({ id: taskId }) });

    expect(response.status).toBe(201);
    expect(validateStoredPostMedia).toHaveBeenCalledWith(expect.anything(), userId, []);
    expect(drainAfterHumanEngagement).toHaveBeenCalledTimes(1);
  });

  it("keeps the streak tag by default outside Pivot A", async () => {
    await POST(new Request(`http://localhost/api/tasks/${taskId}/publish`, { method: "POST" }), { params: Promise.resolve({ id: taskId }) });

    expect(update).toHaveBeenCalledWith(expect.not.objectContaining({ streak: null }));
  });

  it("never stores the legacy streak on a win under Pivot A, even when the client asks for it", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
    parseJson.mockResolvedValue({ message: "Done.", visibility: "private", imagePaths: [], showStreakTag: true });

    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/publish`, { method: "POST" }), { params: Promise.resolve({ id: taskId }) });

    expect(response.status).toBe(201);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ streak: null }));
  });
});
