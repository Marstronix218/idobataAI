import { z } from "zod";
import { taskUpdateSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";
import { taskPatchFromInput, updateOwnTask } from "@/lib/server/task-update";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    const input = await parseJson(request, taskUpdateSchema);
    return ok(await updateOwnTask(supabase, user.id, id, taskPatchFromInput(input)));
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
