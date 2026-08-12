import { z } from "zod";
import { publishSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const taskId = z.uuid().parse((await params).id);
    const input = await parseJson(request, publishSchema);
    const result = await supabase.rpc("publish_task_completion", {
      p_task_id: taskId, p_message: input.message ?? null, p_visibility: input.visibility,
      p_recurrence_instance_id: input.recurrenceInstanceId ?? null,
    });
    return ok(assertDatabase(result), { status: 201 });
  });
}
