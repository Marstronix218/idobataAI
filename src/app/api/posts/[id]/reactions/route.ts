import { z } from "zod";
import { reactionSchema } from "@/lib/server/schemas";
import { requireApiGate } from "@/lib/flags/route-gates";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    await requireApiGate("social_feed");
    const { supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const input = await parseJson(request, reactionSchema);
    const result = await supabase.rpc("set_human_reaction", { p_post_id: postId, p_reaction: input.reaction });
    return ok(assertDatabase(result));
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    await requireApiGate("social_feed");
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    // `reply_id is null` is what makes this the *post's* like: without it this
    // would also delete the viewer's likes on replies under the post.
    assertDatabase(await supabase.from("social_reactions").delete().eq("post_id", postId).eq("actor_id", user.id).is("reply_id", null));
    return noContent();
  });
}
