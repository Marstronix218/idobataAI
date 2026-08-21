import { ApiClientError } from "@idobata/api-client";
import type { Task, TaskStatus } from "@idobata/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApiClient } from "../../providers/api-provider";

export type TaskFilter = "pending" | "completed";

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function useTasks() {
  const client = useApiClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("pending");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const inFlightTaskIds = useRef(new Set<string>());
  const latestCompletionTaskId = useRef<string | null>(null);
  const [busyTaskIds, setBusyTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [recentlyCompleted, setRecentlyCompleted] = useState<Task | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!client) return;
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const loaded = await client.listTasks();
      setTasks(loaded);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 0);
    return () => clearTimeout(timeout);
  }, [load]);

  const createTask = useCallback(async (title: string) => {
    if (!client) return false;
    setCreating(true);
    setMutationError(null);
    try {
      const created = await client.createTask({
        title,
        visibility: "private",
      });
      setTasks((current) => [created, ...current]);
      setFilter("pending");
      return true;
    } catch (createError) {
      setMutationError(errorMessage(createError));
      return false;
    } finally {
      setCreating(false);
    }
  }, [client]);

  const setTaskStatus = useCallback(async (task: Task, status: TaskStatus) => {
    if (!client || inFlightTaskIds.current.has(task.id)) return false;
    const optimistic: Task = {
      ...task,
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    inFlightTaskIds.current.add(task.id);
    setBusyTaskIds(new Set(inFlightTaskIds.current));
    setMutationError(null);
    setTasks((current) => current.map((item) => item.id === task.id ? optimistic : item));
    if (status === "completed") {
      latestCompletionTaskId.current = task.id;
      setRecentlyCompleted(optimistic);
    } else if (latestCompletionTaskId.current === task.id) {
      latestCompletionTaskId.current = null;
      setRecentlyCompleted(null);
    }
    try {
      const updated = await client.updateTask(task.id, { status });
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item));
      if (status === "completed" && latestCompletionTaskId.current === task.id) {
        setRecentlyCompleted(updated);
      }
      return true;
    } catch (updateError) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      if (latestCompletionTaskId.current === task.id) {
        latestCompletionTaskId.current = null;
        setRecentlyCompleted(null);
      }
      setMutationError(errorMessage(updateError));
      return false;
    } finally {
      inFlightTaskIds.current.delete(task.id);
      setBusyTaskIds(new Set(inFlightTaskIds.current));
    }
  }, [client]);

  const visibleTasks = useMemo(
    () => tasks
      .filter((task) => task.status === filter)
      .sort((left, right) => {
        const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      }),
    [filter, tasks],
  );

  const counts = useMemo(() => ({
    pending: tasks.filter((task) => task.status === "pending").length,
    completed: tasks.filter((task) => task.status === "completed").length,
  }), [tasks]);

  const dismissCompletion = useCallback(() => {
    latestCompletionTaskId.current = null;
    setRecentlyCompleted(null);
  }, []);

  return {
    visibleTasks,
    counts,
    filter,
    setFilter,
    isLoading,
    isRefreshing,
    creating,
    busyTaskIds,
    error,
    mutationError,
    recentlyCompleted,
    dismissCompletion,
    load,
    createTask,
    setTaskStatus,
  };
}
