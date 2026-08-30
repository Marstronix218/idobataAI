import { createAdminClient } from "@/lib/supabase/admin";
import { assertDatabase, authed, noContent, withApi } from "@/lib/server/http";

export async function POST(request: Request) {
  return withApi(async () => {
    const { user } = await authed(request);
    const admin = createAdminClient();
    assertDatabase(await admin.rpc(
      "record_beta_session_activity" as never,
      { p_user_id: user.id } as never,
    ));
    return noContent();
  });
}
