import { profileSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    return ok(assertDatabase(await supabase.from("user_profiles").select("*").eq("id", user.id).single(), true));
  });
}

export async function PATCH(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const input = await parseJson(request, profileSchema);
    const result = await supabase.from("user_profiles").update({
      ...(input.username !== undefined && { username: input.username }),
      ...(input.avatarUrl !== undefined && { avatar_url: input.avatarUrl }),
      ...(input.dailyGoal !== undefined && { daily_goal: input.dailyGoal }),
      ...(input.interests !== undefined && { interests: input.interests }),
      ...(input.defaultTaskVisibility !== undefined && { default_task_visibility: input.defaultTaskVisibility }),
    }).eq("id", user.id).select("*").single();
    return ok(assertDatabase(result, true));
  });
}

