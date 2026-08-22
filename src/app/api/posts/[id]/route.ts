import { z } from "zod";
import { postUpdateSchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";
import { removePostMedia, signPostMediaByPath } from "@/lib/server/post-media";
import { loadThreadReplies } from "@/lib/server/reply-thread";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPost } from "@/types";

const postSelect = `
  *,
  user_profiles(username, display_name, avatar_url),
  social_companions(name, slug, avatar_url),
  social_reactions(id, reaction, actor_id, companion_id, reply_id),
  social_reposts(id, user_id:actor_id, companion_id, created_at, social_companions(name, slug)),
  quoted_post(
    *,
    user_profiles(username, display_name, avatar_url),
    social_companions(name, slug, avatar_url)
  )
`;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const [postResult, replies] = await Promise.all([
      supabase.from("social_posts").select(postSelect).eq("id", postId).eq("content_status", "active").single(),
      loadThreadReplies(supabase, postId, user.id),
    ]);
    const post = assertDatabase(postResult, true) as unknown as Omit<FeedPost, "social_replies" | "image_urls">;

    const imageUrlByPath = await signPostMediaByPath(createAdminClient(), [
      ...(post.image_paths ?? []),
      ...(post.quoted_post?.image_paths ?? []),
    ]);
    return ok({
      ...post,
      // The post's own like row is the one with no reply target; reply likes now
      // live in the same table and must not be counted against the post.
      social_reactions: post.social_reactions.filter((reaction) => !reaction.reply_id),
      social_replies: replies,
      reply_count: replies.length,
      image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
      quoted_post: post.quoted_post ? {
        ...post.quoted_post,
        image_urls: (post.quoted_post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
      } : null,
    });
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const input = await parseJson(request, postUpdateSchema);
    const result = await supabase.from("social_posts")
      .update({ visibility: input.visibility })
      .eq("id", postId)
      .eq("author_id", user.id)
      .select("visibility")
      .single();
    return ok(assertDatabase(result, true));
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const post = assertDatabase(await supabase.from("social_posts")
      .select("image_paths")
      .eq("id", postId)
      .eq("author_id", user.id)
      .single(), true) as { image_paths: string[] };

    const mediaRemoved = await removePostMedia(createAdminClient(), post.image_paths ?? []);
    if (!mediaRemoved) throw new ApiError(503, "The post could not be deleted safely. Please try again.", "media_cleanup_failed");

    assertDatabase(await supabase.from("social_posts")
      .delete()
      .eq("id", postId)
      .eq("author_id", user.id));
    return noContent();
  });
}
