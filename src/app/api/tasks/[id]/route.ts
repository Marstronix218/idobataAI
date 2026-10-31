import { z } from "zod";
import type { TaskWriteResult } from "@idobata/contracts";
import { getFlags } from "@/lib/flags";
import { taskTextSuggestsCrisis } from "@/lib/safety/task-text";
import { taskUpdateSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { taskPatchFromInput, updateOwnTask } from "@/lib/server/task-update";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    const input = await parseJson(request, taskUpdateSchema);
    // Pivot A: re-check the text only when the title or note actually changes.
    const textInPatch = input.title !== undefined || input.description !== undefined;
    // Text edits can reach the distress check, so they share the task creation
    // budget. Status toggles and other fields stay unlimited, as before.
    if (textInPatch) await enforceRateLimit(user.id, "task:update", 120, 3600);
    const prior = textInPatch && (await getFlags()).pivotA
      ? assertDatabase(await supabase.from("tasks").select("title, description").eq("id", id).eq("owner_id", user.id).maybeSingle())
      : null;
    const task = await updateOwnTask(supabase, user.id, id, taskPatchFromInput(input));
    // The edit is saved either way; distress text adds the crisis card (D3: nothing stored).
    const textChanged = prior !== null && (task.title !== prior.title || task.description !== prior.description);
    if (textChanged && await taskTextSuggestsCrisis(user.id, task)) {
      return ok({ ...task, safety: { crisisCard: true } } satisfies TaskWriteResult);
    }
    return ok(task);
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    const result = await supabase.from("tasks").delete().eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
    assertDatabase(result);
    return noContent();
  });
}
