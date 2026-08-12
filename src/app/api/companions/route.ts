import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const url = new URL(request.url);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const [result, muteResult] = await Promise.all([
      supabase.from("social_companions")
        .select("id, slug, name, avatar_url, personality, writing_style, interests, active, posting_frequency", { count: "exact" })
        .eq("active", true).order("name").range(offset, offset + limit - 1),
      supabase.from("muted_companions").select("companion_id"),
    ]);
    const data = assertDatabase(result) ?? [];
    const muted = assertDatabase(muteResult) ?? [];
    return ok({ items: data, count: result.count ?? data.length, mutedIds: muted.map((row) => row.companion_id) });
  });
}
