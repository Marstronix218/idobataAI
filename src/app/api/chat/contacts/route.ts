import { ApiError, assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import type { ChatContact, SocialCompanion, UserProfile } from "@/types";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length > 50) throw new ApiError(400, "Search must be 50 characters or fewer.");
    const pattern = `%${query.replace(/[%,]/g, "")}%`;

    let profilesQuery = supabase.from("user_profiles")
      .select("id, username, display_name, avatar_url, bio")
      .neq("id", user.id)
      .order("username")
      .limit(12);
    let companionsQuery = supabase.from("social_companions")
      .select("id, slug, name, avatar_url, personality")
      .eq("active", true)
      .order("name")
      .limit(12);
    if (query) {
      profilesQuery = profilesQuery.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
      companionsQuery = companionsQuery.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
    }

    const [profileResult, companionResult] = await Promise.all([profilesQuery, companionsQuery]);
    const profiles = assertDatabase(profileResult) as Array<Pick<UserProfile, "id" | "username" | "display_name" | "avatar_url" | "bio">>;
    const companions = assertDatabase(companionResult) as Array<Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality">>;
    const items: ChatContact[] = [
      ...profiles.map((profile) => ({
        id: profile.id,
        kind: "user" as const,
        name: profile.display_name?.trim() || profile.username,
        handle: profile.username,
        avatarUrl: profile.avatar_url,
        description: profile.bio,
      })),
      ...companions.map((companion) => ({
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
