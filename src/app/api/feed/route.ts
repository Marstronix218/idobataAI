import { ApiError, assertDatabase, authed, makeCursor, ok, parseCursor, withApi } from "@/lib/server/http";

const feedSelect = `
  *,
  user_profiles(username, avatar_url),
  social_companions(name, slug, avatar_url),
  social_reactions(id, reaction, actor_id, companion_id),
  social_replies(*, user_profiles(username, avatar_url), social_companions(name, slug, avatar_url))
`;

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "community";
    if (!new Set(["community", "mine"]).has(scope)) throw new ApiError(400, "Invalid feed scope.");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    let query = supabase.from("social_posts").select(feedSelect).eq("content_status", "active")
      .lte("created_at", new Date().toISOString())
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (scope === "mine") query = query.eq("author_id", user.id);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const rows = assertDatabase(await query) as unknown as Array<{ id: string; created_at: string }>;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return ok({ items, nextCursor: hasMore && items.length ? makeCursor(items[items.length - 1]) : null });
  });
}
