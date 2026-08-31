import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, drainAfterHumanEngagement, parseJson, removePostMedia, validateStoredPostMedia } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  drainAfterHumanEngagement: vi.fn(),
  parseJson: vi.fn(),
  removePostMedia: vi.fn(),
  validateStoredPostMedia: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ drainAfterHumanEngagement }));
vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T,>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/post-media", () => ({ removePostMedia, validateStoredPostMedia }));

import { POST } from "@/app/api/tasks/[id]/publish/route";

describe("completion post tag choices", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({
      message: null,
      visibility: "public",
      showCategoryTag: false,
      showStreakTag: false,
    });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", author_id: userId, category: "Work", streak: 6, image_paths: [] },
          error: null,
        }),
      },
    });
    update.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", category: null, streak: null, image_paths: [] },
              error: null,
            }),
          })),
        })),
      })),
    });
    createAdminClient.mockReturnValue({ from: vi.fn(() => ({ update })) });
  });

  it("removes hidden category and streak tags from the persisted post", async () => {
    const response = await POST(
      new Request(`http://localhost/api/tasks/${taskId}/publish`, { method: "POST" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(201);
    expect(update).toHaveBeenCalledWith({
      visibility: "public",
      image_paths: [],
      category: null,
      streak: null,
    });
  });
});
