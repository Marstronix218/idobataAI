import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, removePostMedia } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  removePostMedia: vi.fn(),
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
  noContent: () => new Response(null, { status: 204 }),
  ok: (data: unknown) => Response.json({ data }),
  parseJson: vi.fn(),
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
vi.mock("@/lib/server/post-media", () => ({
  removePostMedia,
  signPostMediaByPath: vi.fn(),
}));

import { DELETE } from "@/app/api/posts/[id]/route";

describe("post owner deletion", () => {
  const postId = "aaaaaaaa-1000-4000-8000-000000000001";
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const deleteFromDatabase = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const selectSingle = vi.fn().mockResolvedValue({ data: { image_paths: [`${userId}/pending/aaaaaaaa-2000-4000-8000-000000000001.jpg`] }, error: null });
    const secondEq = vi.fn(() => ({ single: selectSingle }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const deleteSecondEq = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFirstEq = vi.fn(() => ({ eq: deleteSecondEq }));
    deleteFromDatabase.mockReturnValue({ eq: deleteFirstEq });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: firstEq })), delete: deleteFromDatabase })) },
    });
    createAdminClient.mockReturnValue({});
  });

  it("keeps the post retryable when its private media cannot be removed", async () => {
    removePostMedia.mockResolvedValue(false);

    const response = await DELETE(new Request(`https://app.example.com/api/posts/${postId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: postId }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "media_cleanup_failed", message: "The post could not be deleted safely. Please try again." } });
    expect(deleteFromDatabase).not.toHaveBeenCalled();
  });
});
