import { z } from "zod";
import { taskUpdateSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    const input = await parseJson(request, taskUpdateSchema);
    const patch = {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.dueAt !== undefined && { due_at: input.dueAt }),
      ...(input.recurrenceRule !== undefined && { recurrence_rule: input.recurrenceRule }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
      ...(input.status !== undefined && { status: input.status }),
    };
    const result = await supabase.from("tasks").update(patch).eq("id", id).eq("owner_id", user.id).select("*").single();
    return ok(assertDatabase(result, true));
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
