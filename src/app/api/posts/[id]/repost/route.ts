import { z } from "zod";
import { quoteRepostSchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const postId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    const input = await parseJson(request, quoteRepostSchema);
    const quote = assertDatabase(await supabase.rpc("publish_quote_repost", {
      p_post_id: postId,
      p_content: input.content,
      p_visibility: input.visibility,
      p_idempotency_key: input.idempotencyKey,
    }));
    if (!quote) throw new ApiError(409, "The quote repost could not be created.", "quote_repost_not_created");
    return ok(quote, { status: 201 });
  });
}

export async function PUT(request: Request, { params }: Context) {
  return withApi(async () => {
    const postId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    const repost = assertDatabase(await supabase.rpc("set_human_repost", {
      p_post_id: postId,
      p_reposted: true,
    }));
    if (!repost) throw new ApiError(409, "The repost could not be created.", "repost_not_created");
    return ok({
      id: repost.id,
      post_id: repost.post_id,
      user_id: repost.actor_id,
      companion_id: repost.companion_id,
      created_at: repost.created_at,
    });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const postId = z.uuid().parse((await params).id);
    const { supabase } = await authed(request);
    assertDatabase(await supabase.rpc("set_human_repost", {
      p_post_id: postId,
      p_reposted: false,
    }));
    return noContent();
  });
}
