import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

type BlockedUserRow = {
  user_profiles: {
    id: string;
    display_name: string | null;
    username: string;
    avatar_url: string | null;
  } | null;
};

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const result = await supabase
      .from("blocked_users")
      .select("user_profiles!blocked_users_blocked_id_fkey(id, display_name, username, avatar_url)")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false });
    const rows = (assertDatabase(result) ?? []) as unknown as BlockedUserRow[];

    return ok({
      items: rows.flatMap(({ user_profiles: profile }) => profile ? [{
        id: profile.id,
        name: profile.display_name ?? profile.username,
        username: profile.username,
        avatarUrl: profile.avatar_url,
      }] : []),
    });
  });
}
