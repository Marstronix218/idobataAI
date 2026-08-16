import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

type MutedCompanionRow = {
  social_companions: {
    id: string;
    name: string;
    slug: string;
    avatar_url: string | null;
  } | null;
};

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const result = await supabase
      .from("muted_companions")
      .select("social_companions!muted_companions_companion_id_fkey(id, name, slug, avatar_url)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const rows = (assertDatabase(result) ?? []) as unknown as MutedCompanionRow[];

    return ok({
      items: rows.flatMap(({ social_companions: companion }) => companion ? [{
        id: companion.id,
        name: companion.name,
        slug: companion.slug,
        avatarUrl: companion.avatar_url,
      }] : []),
    });
  });
}
