import { ApiError, assertDatabase, authed, makeCursor, ok, parseCursor, withApi } from "@/lib/server/http";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPost } from "@/types";

// The list feed renders reaction counts and a "did I react" state, and does not
// render replies at all -- those appear only in the post detail view. Expanding
// `social_replies(*, ...)` here joined two extra tables per post for output that
// was thrown away, and neither nested relation was bounded, so a single popular
// post degraded the feed for everyone who saw it.
const feedSelect = `
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

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "for-you";
    if (!new Set(["for-you", "following", "people", "community", "mine"]).has(scope)) throw new ApiError(400, "Invalid feed scope.");
    const category = url.searchParams.get("category")?.trim() ?? "";
    if (category.length > 48) throw new ApiError(400, "Category must be 48 characters or fewer.");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    let query = supabase.from("social_posts").select(feedSelect).eq("content_status", "active")
      // Reply likes share this table, so the embedded reactions must be narrowed
      // to the post's own -- otherwise a busy thread inflates the post like count.
      .is("social_reactions.reply_id", null)
      .lte("created_at", new Date().toISOString())
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (scope === "mine") query = query.eq("author_id", user.id);
    if (scope === "people") query = query.is("companion_id", null);
    if (scope === "following") {
      const followedPosts = assertDatabase(await supabase.rpc("get_following_post_ids", {
        p_category: category || null,
        p_before: cursor?.created_at ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: limit + 1,
      })) ?? [];
      const followedPostIds = followedPosts.map((post) => post.post_id);
      if (!followedPostIds.length) return ok({ items: [], nextCursor: null });
      query = query.in("id", followedPostIds);
    }
    if (category) query = query.eq("category", category);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const rows = assertDatabase(await query) as unknown as Array<{ id: string; created_at: string }>;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit) as unknown as FeedPost[];
    const admin = createAdminClient();
    const imagePaths = Array.from(new Set(items.flatMap((post) => [
      ...(post.image_paths ?? []),
      ...(post.quoted_post?.image_paths ?? []),
    ])));
    const imageUrlByPath = await signPostMediaByPath(admin, imagePaths);
    const signedItems = items.map((post) => ({
      ...post,
      // Always an array so consumers never read `.length` of undefined; the
      // list feed shows `reply_count` and the detail route supplies the bodies.
      social_replies: [],
      social_reposts: post.social_reposts ?? [],
      image_urls: (post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
      quoted_post: post.quoted_post ? {
        ...post.quoted_post,
        image_urls: (post.quoted_post.image_paths ?? []).map((path) => imageUrlByPath.get(path)).filter((url): url is string => Boolean(url)),
      } : null,
    }));
    return ok({ items: signedItems, nextCursor: hasMore && items.length ? makeCursor(items[items.length - 1]) : null });
  });
}
