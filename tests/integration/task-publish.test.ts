import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authed,
  createAdminClient,
  drainAfterHumanEngagement,
  parseJson,
  removePostMedia,
  validateStoredPostMedia,
} = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  drainAfterHumanEngagement: vi.fn(),
  parseJson: vi.fn(),
  removePostMedia: vi.fn(),
  validateStoredPostMedia: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ drainAfterHumanEngagement }));
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
    parseJson.mockResolvedValue({ message: "Done.", visibility: "private", imagePaths: [] });
    validateStoredPostMedia.mockResolvedValue(undefined);
    removePostMedia.mockResolvedValue(true);

    const single = vi.fn().mockResolvedValue({ data: post, error: null });
    const select = vi.fn(() => ({ single }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const update = vi.fn(() => ({ eq: firstEq }));
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
});
