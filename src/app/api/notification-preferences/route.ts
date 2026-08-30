import { notificationPreferencesSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    return ok(assertDatabase(await supabase.from("notification_preferences").select("*").eq("user_id", user.id).single(), true));
  });
}

export async function PATCH(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const input = await parseJson(request, notificationPreferencesSchema);
    const result = await supabase.from("notification_preferences").update({
      ...(input.reactions !== undefined && { reactions: input.reactions }),
      ...(input.replies !== undefined && { replies: input.replies }),
      ...(input.companionActivity !== undefined && { companion_activity: input.companionActivity }),
    }).eq("user_id", user.id).select("*").single();
    return ok(assertDatabase(result, true));
  });
}
