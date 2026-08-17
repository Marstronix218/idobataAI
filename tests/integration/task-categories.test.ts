import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, parseJson } = vi.hoisted(() => ({
  authed: vi.fn(),
  parseJson: vi.fn(),
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
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

import { POST } from "@/app/api/task-categories/route";
import { DELETE, PATCH } from "@/app/api/task-categories/[id]/route";

describe("task category routes", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const insert = vi.fn();
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({ name: "Work" });
    insert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: categoryId, owner_id: userId, name: "Work" },
          error: null,
        }),
      })),
    });
    rpc.mockResolvedValue({ data: { id: categoryId, owner_id: userId, name: "Office" }, error: null });
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        from: vi.fn(() => ({ insert })),
        rpc,
      },
    });
  });

  it("creates a reusable category owned by the signed-in user", async () => {
    const response = await POST(new Request("http://localhost/api/task-categories", {
      method: "POST",
      body: JSON.stringify({ name: "Work" }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ owner_id: userId, name: "Work" });
  });

  it("renames a category through the transactional database function", async () => {
    parseJson.mockResolvedValue({ name: "Office" });
    const response = await PATCH(
      new Request(`http://localhost/api/task-categories/${categoryId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: categoryId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("rename_task_category", {
      p_category_id: categoryId,
      p_name: "Office",
    });
  });

  it("deletes a category through the task-clearing database function", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const response = await DELETE(
      new Request(`http://localhost/api/task-categories/${categoryId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: categoryId }) },
    );

    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("delete_task_category", { p_category_id: categoryId });
  });
});
