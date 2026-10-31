import { requireAgeVerified } from "@/lib/coach/age";
import { readStoryOverview, STORY_RATE_LIMIT } from "@/lib/coach/story";
import { requireApiGate } from "@/lib/flags/route-gates";
import { authed, ok, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

/**
 * The selected character's chapters with their lock state: titles always,
 * bodies never. `character` is null and `chapters` empty without a selected
 * character. Chapters open with consistency days and the plan, never with
 * time in the app.
 */
export async function GET(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    await requireAgeVerified(supabase, user.id);
    await enforceRateLimit(user.id, STORY_RATE_LIMIT.bucket, STORY_RATE_LIMIT.limit, STORY_RATE_LIMIT.windowSeconds);
    return ok(await readStoryOverview(supabase, user.id));
  });
}
