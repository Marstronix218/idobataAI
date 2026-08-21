import type { Task } from "@idobata/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("../../apps/mobile/src/providers/api-provider", () => ({
  useApiClient: () => api,
}));

import { useTasks } from "../../apps/mobile/src/features/tasks/use-tasks";

function task(id: string, priority: Task["priority"] = null): Task {
  return {
    id,
    owner_id: "22222222-2222-4222-8222-222222222222",
    title: `Task ${id}`,
    description: null,
    category: null,
    due_at: null,
    recurrence_rule: null,
    recurrence_instance_id: null,
    priority,
    visibility: "private",
    status: "pending",
    xp_earned: 0,
    completed_at: null,
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("mobile task state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTasks.mockResolvedValue([]);
  });

  it("keeps independent mutation guards until each request settles", async () => {
    const first = task("11111111-1111-4111-8111-111111111111", 1);
    const second = task("33333333-3333-4333-8333-333333333333", 2);
    const firstUpdate = deferred<Task>();
    const secondUpdate = deferred<Task>();
    api.listTasks.mockResolvedValue([first, second]);
    api.updateTask
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let firstRequest!: Promise<boolean>;
    let secondRequest!: Promise<boolean>;
    act(() => {
      firstRequest = result.current.setTaskStatus(first, "completed");
      secondRequest = result.current.setTaskStatus(second, "completed");
    });
    expect(result.current.busyTaskIds).toEqual(new Set([first.id, second.id]));

    firstUpdate.resolve({ ...first, status: "completed", completed_at: "2026-08-20T12:01:00.000Z" });
    await act(async () => void await firstRequest);
    expect(result.current.busyTaskIds.has(first.id)).toBe(false);
    expect(result.current.busyTaskIds.has(second.id)).toBe(true);
    expect(result.current.recentlyCompleted?.id).toBe(second.id);

    await expect(result.current.setTaskStatus(second, "completed")).resolves.toBe(false);
    expect(api.updateTask).toHaveBeenCalledTimes(2);

    secondUpdate.resolve({ ...second, status: "completed", completed_at: "2026-08-20T12:02:00.000Z" });
    await act(async () => void await secondRequest);
    expect(result.current.busyTaskIds.size).toBe(0);
    expect(result.current.recentlyCompleted?.id).toBe(second.id);
  });

  it("rolls an optimistic completion back when the API rejects it", async () => {
    const original = task("11111111-1111-4111-8111-111111111111");
    api.listTasks.mockResolvedValue([original]);
    api.updateTask.mockRejectedValue(new Error("Update failed"));
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.visibleTasks).toHaveLength(1));

    await act(async () => {
      await result.current.setTaskStatus(original, "completed");
    });

    expect(result.current.visibleTasks[0]?.status).toBe("pending");
    expect(result.current.mutationError).toBe("Update failed");
    expect(result.current.busyTaskIds.size).toBe(0);
  });

  it("does not recreate a dismissed completion banner when its request settles", async () => {
    const original = task("11111111-1111-4111-8111-111111111111");
    const update = deferred<Task>();
    api.listTasks.mockResolvedValue([original]);
    api.updateTask.mockReturnValue(update.promise);
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.visibleTasks).toHaveLength(1));

    let request!: Promise<boolean>;
    act(() => {
      request = result.current.setTaskStatus(original, "completed");
    });
    expect(result.current.recentlyCompleted?.id).toBe(original.id);

    act(() => result.current.dismissCompletion());
    expect(result.current.recentlyCompleted).toBeNull();

    update.resolve({
      ...original,
      status: "completed",
      completed_at: "2026-08-20T12:01:00.000Z",
    });
    await act(async () => void await request);
    expect(result.current.recentlyCompleted).toBeNull();
  });

  it("preserves cached tasks and exposes a refresh error", async () => {
    const cached = task("11111111-1111-4111-8111-111111111111");
    api.listTasks.mockResolvedValueOnce([cached]).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.visibleTasks).toHaveLength(1));

    await act(async () => {
      await result.current.load(true);
    });

    expect(result.current.visibleTasks).toEqual([cached]);
    expect(result.current.error).toBe("Offline");
    expect(result.current.isRefreshing).toBe(false);
  });
});
