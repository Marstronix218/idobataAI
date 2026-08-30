import { ApiError, assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import type { ChatContact, SocialCompanion, UserProfile } from "@/types";

const PROFILE_RESULT_LIMIT = 12;
const COMPANION_RESULT_LIMIT = 200;

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length > 50) throw new ApiError(400, "Search must be 50 characters or fewer.");
    const pattern = `%${query.replace(/[%,]/g, "")}%`;

    // Directory search runs through a definer function so the projection is
    // fixed server-side, private profiles are never enumerated, and the LIKE
    // wildcards in the query string are escaped rather than pattern-matched.
    const profilesQuery = supabase.rpc("search_chat_contacts", { p_query: query, p_limit: PROFILE_RESULT_LIMIT });
    // Personas are a small curated roster, so the picker lists every active one
    // rather than truncating it the way the open-ended profile search must.
    let companionsQuery = supabase.from("social_companions")
      .select("id, slug, name, avatar_url, personality")
      .eq("active", true)
      .order("name")
      .limit(COMPANION_RESULT_LIMIT);
    if (query) {
      companionsQuery = companionsQuery.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
    }

    const [profileResult, companionResult, relationshipResult] = await Promise.all([
      profilesQuery,
      companionsQuery,
      supabase.from("user_companion_relationships").select("companion_id, user_followed_at, is_favorite").eq("user_id", user.id),
    ]);
    const profiles = assertDatabase(profileResult) as Array<Pick<UserProfile, "id" | "username" | "display_name" | "avatar_url" | "bio">>;
    const companions = assertDatabase(companionResult) as Array<Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality">>;
    const relationships = assertDatabase(relationshipResult) ?? [];
    const relationshipByCompanionId = new Map(relationships.map((relationship) => [relationship.companion_id, relationship]));
    const orderedCompanions = [...companions].sort((left, right) => {
      const leftRelationship = relationshipByCompanionId.get(left.id);
      const rightRelationship = relationshipByCompanionId.get(right.id);
      return Number(Boolean(rightRelationship?.is_favorite)) - Number(Boolean(leftRelationship?.is_favorite))
        || Number(Boolean(rightRelationship?.user_followed_at)) - Number(Boolean(leftRelationship?.user_followed_at))
        || left.name.localeCompare(right.name);
    });
    const items: ChatContact[] = [
      ...profiles.map((profile) => ({
        id: profile.id,
        kind: "user" as const,
        name: profile.display_name?.trim() || profile.username,
        handle: profile.username,
        avatarUrl: profile.avatar_url,
        description: profile.bio,
      })),
      ...orderedCompanions.map((companion) => ({
        id: companion.id,
        kind: "companion" as const,
        name: companion.name,
        handle: companion.slug,
        avatarUrl: companion.avatar_url,
        description: companion.personality,
      })),
    ];
    return ok({ items });
  });
}
