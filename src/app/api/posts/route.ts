import { drainAfterHumanEngagement } from "@/lib/ai";
import { progressPostSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

// `after` runs inside the route's budget, and the inline drain calls the AI
// provider, whose own request times out at 8s.
export const maxDuration = 30;

export async function POST(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, progressPostSchema);
    const result = await supabase.rpc("publish_progress_post", {
      p_content: input.content, p_visibility: input.visibility, p_idempotency_key: input.idempotencyKey,
      p_task_id: input.taskId ?? null, p_task_title: input.taskTitle ?? null, p_category: input.category ?? null,
    });
    const post = assertDatabase(result);
    drainAfterHumanEngagement();
    return ok(post, { status: 201 });
  });
}
