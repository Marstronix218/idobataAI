import { profileSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    return ok(assertDatabase(await supabase.from("user_profiles").select("*").eq("id", user.id).single(), true));
  });
}

export async function PATCH(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    await enforceRateLimit(user.id, "profile:update", 20, 3600);
    const input = await parseJson(request, profileSchema);
    const result = await supabase.from("user_profiles").update({
      ...(input.username !== undefined && { username: input.username }),
      ...(input.displayName !== undefined && { display_name: input.displayName || null }),
      ...(input.bio !== undefined && { bio: input.bio || null }),
      ...(input.avatarUrl !== undefined && { avatar_url: input.avatarUrl }),
      ...(input.profileVisibility !== undefined && { profile_visibility: input.profileVisibility }),
      ...(input.dailyGoal !== undefined && { daily_goal: input.dailyGoal }),
      ...(input.interests !== undefined && { interests: input.interests }),
      ...(input.defaultTaskVisibility !== undefined && { default_task_visibility: input.defaultTaskVisibility }),
      ...(input.completionVisibility !== undefined && { completion_visibility: input.completionVisibility }),
    }).eq("id", user.id).select("*").single();
    return ok(assertDatabase(result, true));
  });
}
