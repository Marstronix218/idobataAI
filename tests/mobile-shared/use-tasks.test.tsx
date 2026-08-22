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
import { currentTimeZone, taskDeadlineLabel } from "../../apps/mobile/src/features/tasks/deadline";

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
    due_has_time: false,
    due_timezone: null,
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

  it("creates a task with an optional exact deadline", async () => {
    const dueAt = "2026-08-22T23:30:00.000Z";
    const dueTimezone = currentTimeZone();
    const created = { ...task("11111111-1111-4111-8111-111111111111"), title: "Outline the proposal", due_at: dueAt, due_has_time: true, due_timezone: dueTimezone };
    api.createTask.mockResolvedValue(created);
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.createTask("Outline the proposal", dueAt, true);
    });

    expect(succeeded).toBe(true);
    expect(api.createTask).toHaveBeenCalledWith({ title: "Outline the proposal", dueAt, dueHasTime: true, dueTimezone, visibility: "private" });
    expect(result.current.visibleTasks[0]).toMatchObject({ due_at: dueAt, due_has_time: true, due_timezone: dueTimezone });
  });

  it("updates a timed deadline label after its exact cutoff without shaming completed tasks", () => {
    const timed = {
      ...task("11111111-1111-4111-8111-111111111111"),
      due_at: "2026-08-22T23:30:00.000Z",
      due_has_time: true,
      due_timezone: currentTimeZone(),
    };

    expect(taskDeadlineLabel(timed, Date.parse("2026-08-22T23:29:00.000Z"))).not.toContain("Overdue");
    expect(taskDeadlineLabel(timed, Date.parse("2026-08-22T23:31:00.000Z"))).toContain("Overdue");
    expect(taskDeadlineLabel({ ...timed, status: "completed" }, Date.parse("2026-08-22T23:31:00.000Z"))).not.toContain("Overdue");
  });

  it("sets and clears a deadline without changing task status", async () => {
    const original = { ...task("11111111-1111-4111-8111-111111111111"), due_at: "2026-08-22T23:30:00.000Z", due_has_time: true, due_timezone: currentTimeZone() };
    const updated = { ...original, due_at: null, due_has_time: false, due_timezone: null };
    api.listTasks.mockResolvedValue([original]);
    api.updateTask.mockResolvedValue(updated);
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.visibleTasks).toHaveLength(1));

    await act(async () => {
      await result.current.setTaskDeadline(original, null, false);
    });

    expect(api.updateTask).toHaveBeenCalledWith(original.id, { dueAt: null, dueHasTime: false, dueTimezone: null });
    expect(result.current.visibleTasks[0]).toMatchObject({ due_at: null, due_has_time: false, due_timezone: null, status: "pending" });
  });

  it("rolls an optimistic deadline change back when the API rejects it", async () => {
    const original = task("11111111-1111-4111-8111-111111111111");
    api.listTasks.mockResolvedValue([original]);
    api.updateTask.mockRejectedValue(new Error("Deadline update failed"));
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.visibleTasks).toHaveLength(1));

    await act(async () => {
      await result.current.setTaskDeadline(original, "2026-08-22T23:30:00.000Z", true);
    });

    expect(result.current.visibleTasks[0]).toEqual(original);
    expect(result.current.mutationError).toBe("Deadline update failed");
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
