import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

// A count-only endpoint so the app shell can surface unread encouragement
// without pulling notification bodies on every poll. RLS scopes the count, and
// the explicit user_id predicate lets the partial unread index serve it.
export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const result = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    const unread = assertDatabase({ data: result.count ?? 0, error: result.error });
    return ok({ unread });
  });
}
