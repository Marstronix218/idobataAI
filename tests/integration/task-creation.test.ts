import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, parseJson, rateLimitRpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  parseJson: vi.fn(),
  rateLimitRpc: vi.fn(),
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
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { POST } from "@/app/api/tasks/route";

describe("task creation route", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitRpc.mockResolvedValue({ data: true, error: null });
    createAdminClient.mockReturnValue({ rpc: rateLimitRpc });
    parseJson.mockResolvedValue({
      title: "Prepare the launch notes",
      category: "Work",
      dueAt: null,
      recurrenceRule: null,
      priority: 1,
    });

    const createdTask = {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      owner_id: userId,
      title: "Prepare the launch notes",
      visibility: "private",
    };
    insert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: createdTask, error: null }),
      })),
    });

    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        from: vi.fn((table: string) => {
          if (table === "user_profiles") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: { default_task_visibility: "private" }, error: null }),
                })),
              })),
            };
          }
          return { insert };
        }),
      },
    });
  });

  it("inserts only columns granted to authenticated users", async () => {
    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Prepare the launch notes", category: "Work" }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      owner_id: userId,
      title: "Prepare the launch notes",
      description: null,
      category: "Work",
      due_at: null,
      recurrence_rule: null,
      priority: 1,
      visibility: "private",
    });
  });

  it("stores an omitted priority as no priority", async () => {
    parseJson.mockResolvedValueOnce({
      title: "Prepare the launch notes",
      category: "Work",
      dueAt: null,
      recurrenceRule: null,
    });

    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Prepare the launch notes", category: "Work" }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ priority: null }));
  });
});
