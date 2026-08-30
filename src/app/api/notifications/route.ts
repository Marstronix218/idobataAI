import { notificationReadSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, makeCursor, ok, parseCursor, parseJson, withApi } from "@/lib/server/http";
import { signPostMediaByPath } from "@/lib/server/post-media";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityItem } from "@/types";

// A quote notification points at the quoting post, not the original, so the row
// can render the new commentary with the original embedded the way it appears
// in a feed. That needs the author, the media, and one level of `quoted_post`.
const notificationSelect = `
  *,
  user_profiles!notifications_actor_id_fkey(username, display_name, avatar_url),
  social_companions(name, slug, avatar_url),
  social_posts(
    id, content, task_title, category, kind, content_status, image_paths, created_at,
    author_id, companion_id, visibility,
    user_profiles(username, display_name, avatar_url),
    social_companions(name, slug, avatar_url),
    quoted_post(
      id, content, task_title, category, kind, content_status, image_paths, created_at,
      author_id, companion_id, visibility,
      user_profiles(username, display_name, avatar_url),
      social_companions(name, slug, avatar_url)
    )
  )
`;

// Only quote notifications render media, so the signing round trip is skipped
// entirely for a page of likes, replies, and follows.
async function signNotificationMedia(items: ActivityItem[]) {
  const paths = Array.from(new Set(items.flatMap((item) => item.kind === "quote" ? [
    ...(item.social_posts?.image_paths ?? []),
    ...(item.social_posts?.quoted_post?.image_paths ?? []),
  ] : [])));
  if (!paths.length) return items;
  const urlByPath = await signPostMediaByPath(createAdminClient(), paths);
  const sign = (values: string[] | null | undefined) =>
    (values ?? []).map((path) => urlByPath.get(path)).filter((url): url is string => Boolean(url));
  return items.map((item) => item.kind !== "quote" || !item.social_posts ? item : {
    ...item,
    social_posts: {
      ...item.social_posts,
      image_urls: sign(item.social_posts.image_paths),
      quoted_post: item.social_posts.quoted_post ? {
        ...item.social_posts.quoted_post,
        image_urls: sign(item.social_posts.quoted_post.image_paths),
      } : null,
    },
  });
}

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
    const unreadOnly = url.searchParams.get("unread") === "true";
    const cursor = parseCursor(url.searchParams.get("cursor"));
    let query = supabase.from("notifications")
      .select(notificationSelect)
      .eq("user_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (unreadOnly) query = query.is("read_at", null);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const rows = assertDatabase(await query) as unknown as ActivityItem[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return ok({ items: await signNotificationMedia(items), nextCursor: hasMore && items.length ? makeCursor(items[items.length - 1]) : null });
  });
}

export async function PATCH(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, notificationReadSchema);
    const result = await supabase.rpc("mark_notifications_read", { p_ids: input.ids ?? null, p_all: input.all === true });
    return ok({ updated: assertDatabase(result) });
  });
}

