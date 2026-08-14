import { z } from "zod";
import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPost } from "@/types";

const postSelect = `
  *,
  user_profiles(username, avatar_url),
  social_companions(name, slug, avatar_url),
  social_reactions(id, reaction, actor_id, companion_id)
`;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const postId = z.uuid().parse((await params).id);
    const [postResult, repliesResult] = await Promise.all([
      supabase.from("social_posts").select(postSelect).eq("id", postId).eq("content_status", "active").single(),
      supabase.from("social_replies")
        .select("*, user_profiles(username, avatar_url), social_companions(name, slug, avatar_url)")
        .eq("post_id", postId)
        .eq("content_status", "active")
        .order("created_at")
        .limit(200),
    ]);
    const post = assertDatabase(postResult, true) as unknown as Omit<FeedPost, "social_replies" | "image_urls">;
    const replies = assertDatabase(repliesResult) as unknown as FeedPost["social_replies"];

    const imageUrlByPath = await signPostMediaByPath(createAdminClient(), post.image_paths ?? []);
    return ok({
      ...post,
      social_replies: replies,
      image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
    });
  });
}
