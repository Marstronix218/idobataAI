import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, parseJson } = vi.hoisted(() => ({
  authed: vi.fn(),
  parseJson: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
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

import { PATCH } from "@/app/api/tasks/[id]/route";

describe("task update route", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({ priority: 2, status: "completed" });

    update.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: taskId, owner_id: userId, priority: 2, status: "completed" },
              error: null,
            }),
          })),
        })),
      })),
    });

    authed.mockResolvedValue({
      user: { id: userId },
      supabase: { from: vi.fn(() => ({ update })) },
    });
  });

  it("persists a priority change alongside task completion", async () => {
    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ priority: 2, status: "completed" });
    expect(await response.json()).toEqual({
      data: { id: taskId, owner_id: userId, priority: 2, status: "completed" },
    });
  });

  it("clears priority without dropping the field from the patch", async () => {
    parseJson.mockResolvedValueOnce({ priority: null });

    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ priority: null });
  });

  it("sets an exact deadline time", async () => {
    parseJson.mockResolvedValueOnce({
      dueAt: "2026-08-22T00:30:00.000Z",
      dueHasTime: true,
      dueTimezone: "America/Los_Angeles",
    });

    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      due_at: "2026-08-22T00:30:00.000Z",
      due_has_time: true,
      due_timezone: "America/Los_Angeles",
    });
  });

  it("clears deadline precision without clearing the due date", async () => {
    parseJson.mockResolvedValueOnce({ dueHasTime: false });

    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ due_has_time: false, due_timezone: null });
  });

  it("keeps legacy due-date updates date-only when precision is omitted", async () => {
    parseJson.mockResolvedValueOnce({ dueAt: "2026-08-23T19:00:00.000Z" });

    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ due_at: "2026-08-23T19:00:00.000Z", due_has_time: false, due_timezone: null });
  });

  it("clears deadline precision whenever the due date is cleared", async () => {
    parseJson.mockResolvedValueOnce({ dueAt: null });

    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH" }),
      { params: Promise.resolve({ id: taskId }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ due_at: null, due_has_time: false, due_timezone: null });
  });
});
