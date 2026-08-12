import { notificationReadSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, makeCursor, ok, parseCursor, parseJson, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
    const unreadOnly = url.searchParams.get("unread") === "true";
    const cursor = parseCursor(url.searchParams.get("cursor"));
    let query = supabase.from("notifications")
      .select("*, user_profiles!notifications_actor_id_fkey(username, avatar_url), social_companions(name, slug, avatar_url), social_posts(content, task_title, content_status)")
      .eq("user_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (unreadOnly) query = query.is("read_at", null);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const rows = assertDatabase(await query) as unknown as Array<{ id: string; created_at: string }>;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return ok({ items, nextCursor: hasMore && items.length ? makeCursor(items[items.length - 1]) : null });
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

