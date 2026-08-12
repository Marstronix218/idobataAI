import { z } from "zod";
import { reactionSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const input = await parseJson(request, reactionSchema);
    const result = await supabase.rpc("set_human_reaction", { p_post_id: postId, p_reaction: input.reaction });
    return ok(assertDatabase(result));
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    assertDatabase(await supabase.from("social_reactions").delete().eq("post_id", postId).eq("actor_id", user.id));
    return noContent();
  });
}
