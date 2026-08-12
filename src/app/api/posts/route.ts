import { progressPostSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function POST(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, progressPostSchema);
    const result = await supabase.rpc("publish_progress_post", {
      p_content: input.content, p_visibility: input.visibility, p_idempotency_key: input.idempotencyKey,
      p_task_id: input.taskId ?? null, p_task_title: input.taskTitle ?? null, p_category: input.category ?? null,
    });
    return ok(assertDatabase(result), { status: 201 });
  });
}
