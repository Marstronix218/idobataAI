import { z } from "zod";
import { drainAfterHumanEngagement } from "@/lib/ai";
import { publishSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { removePostMedia, validateStoredPostMedia } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPost } from "@/types";

type Context = { params: Promise<{ id: string }> };

// `after` runs inside the route's budget, and the inline drain calls the AI
// provider, whose own request times out at 8s.
export const maxDuration = 30;

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const taskId = z.uuid().parse((await params).id);
    const input = await parseJson(request, publishSchema);
    const imagePaths = input.imagePaths ?? [];
    const admin = createAdminClient();

    try {
      await validateStoredPostMedia(admin, user.id, imagePaths);
      const post = assertDatabase(await supabase.rpc("publish_task_completion", {
        p_task_id: taskId,
        p_message: input.message ?? null,
        p_visibility: input.visibility,
        p_recurrence_instance_id: input.recurrenceInstanceId ?? null,
      })) as SocialPost;

      const priorPaths = post.image_paths ?? [];
      const updated = assertDatabase(await admin
        .from("social_posts")
        .update({
          visibility: input.visibility,
          image_paths: imagePaths,
          ...(input.showCategoryTag === false ? { category: null } : {}),
          ...(input.showStreakTag === false ? { streak: null } : {}),
        })
        .eq("id", post.id)
        .eq("author_id", user.id)
        .select("*")
        .single(), true) as SocialPost;

      await removePostMedia(admin, priorPaths.filter((path) => !imagePaths.includes(path)));
      drainAfterHumanEngagement();
      return ok(updated, { status: 201 });
    } catch (error) {
      await removePostMedia(admin, imagePaths);
      throw error;
    }
  });
}
