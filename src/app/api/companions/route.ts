import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const [result, muteResult, relationshipResult] = await Promise.all([
      supabase.from("social_companions")
        .select("id, slug, name, avatar_url, personality, writing_style, interests, active, posting_frequency", { count: "exact" })
        .eq("active", true).order("name").range(offset, offset + limit - 1),
      supabase.from("muted_companions").select("companion_id"),
      supabase.from("user_companion_relationships").select("*").eq("user_id", user.id),
    ]);
    const data = assertDatabase(result) ?? [];
    const muted = assertDatabase(muteResult) ?? [];
    const relationships = assertDatabase(relationshipResult) ?? [];
    const relationshipByCompanionId = new Map(relationships.map((relationship) => [relationship.companion_id, relationship]));
    const items = data.map((companion) => ({
      ...companion,
      relationship: relationshipByCompanionId.get(companion.id) ?? null,
    })).sort((left, right) => {
      const leftRelationship = left.relationship;
      const rightRelationship = right.relationship;
      return Number(Boolean(rightRelationship?.is_favorite)) - Number(Boolean(leftRelationship?.is_favorite))
        || Number(Boolean(rightRelationship?.user_followed_at)) - Number(Boolean(leftRelationship?.user_followed_at))
        || left.name.localeCompare(right.name);
    });
    const favoriteCount = relationships.filter((relationship) => relationship.is_favorite).length;
    return ok({
      items,
      count: result.count ?? items.length,
      mutedIds: muted.map((row) => row.companion_id),
      favoriteCount,
      favoriteLimit: 3,
    });
  });
}
