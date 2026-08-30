import { z } from "zod";
import { drainAfterHumanEngagement } from "@/lib/ai";
import { replySchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { loadThreadReplies } from "@/lib/server/reply-thread";

type Context = { params: Promise<{ id: string }> };

// `after` runs inside the route's budget, and the inline drain calls the AI
// provider, whose own request times out at 8s.
export const maxDuration = 30;

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    return ok(await loadThreadReplies(supabase, postId, user.id));
  });
}

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const input = await parseJson(request, replySchema);
    if (input.parentReplyId) {
      const parent = assertDatabase(await supabase.from("social_replies").select("id, post_id").eq("id", input.parentReplyId).single(), true);
      if (!parent || parent.post_id !== postId) throw new ApiError(422, "Parent reply does not belong to this post.", "invalid_parent_reply");
    }
    const result = await supabase.rpc("create_human_reply", {
      p_post_id: postId, p_parent_reply_id: input.parentReplyId ?? null, p_content: input.content,
    });
    const reply = assertDatabase(result);
    drainAfterHumanEngagement();
    return ok(reply, { status: 201 });
  });
}
