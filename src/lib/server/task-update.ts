import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskUpdateInput } from "@idobata/contracts";
import { assertDatabase } from "@/lib/server/http";
import type { Database, Task } from "@/types";

type TaskPatch = Database["public"]["Tables"]["tasks"]["Update"];

/** The column changes for a validated PATCH /api/tasks/[id] body. */
export function taskPatchFromInput(input: TaskUpdateInput): TaskPatch {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.dueAt !== undefined
      ? {
          due_at: input.dueAt,
          due_has_time: Boolean(input.dueAt && input.dueHasTime),
          due_timezone: input.dueAt && input.dueHasTime ? input.dueTimezone ?? null : null,
        }
      : input.dueHasTime !== undefined && { due_has_time: false, due_timezone: null }),
    ...(input.recurrenceRule !== undefined && { recurrence_rule: input.recurrenceRule }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.visibility !== undefined && { visibility: input.visibility }),
    ...(input.status !== undefined && { status: input.status }),
  };
}

/**
 * Updates one of the caller's tasks with their own client, so RLS and the
 * completion triggers (XP, streak, Pivot A finish events) run exactly as for
 * any other edit. Shared by PATCH /api/tasks/[id] and POST /api/tasks/[id]/finish.
 */
export async function updateOwnTask(supabase: SupabaseClient<Database>, userId: string, taskId: string, patch: TaskPatch): Promise<Task> {
  const result = await supabase.from("tasks").update(patch).eq("id", taskId).eq("owner_id", userId).select("*").single();
  return assertDatabase(result, true) as Task;
}
