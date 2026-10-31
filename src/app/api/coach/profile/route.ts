import { coachProfileUpdateSchema } from "@idobata/contracts";
import { readCoachProfile, toCoachProfile } from "@/lib/coach/profile";
import { requireApiGate } from "@/lib/flags/route-gates";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export async function GET(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    return ok(await readCoachProfile(supabase, user.id));
  });
}

/**
 * Saves the chosen character and/or time zone through `set_coach_profile`,
 * which checks that the character is the caller's to choose and that the zone
 * is a named one. A field left out keeps its stored value.
 */
export async function PUT(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    await enforceRateLimit(user.id, "coach:profile:update", 60, 3600);
    const input = await parseJson(request, coachProfileUpdateSchema);
    const result = await supabase.rpc("set_coach_profile", {
      p_character_id: input.characterId ?? null,
      p_timezone: input.timezone ?? null,
    });
    // The generic mapping would answer "Resource not found." and "That value
    // is not allowed.", which say nothing useful on a picker.
    if (result.error?.code === "P0002") throw new ApiError(404, "That character is not available.", "character_not_found");
    if (result.error?.code === "22023") throw new ApiError(400, "Choose a valid time zone.", "invalid_timezone");
    const row = assertDatabase(result);
    // The upsert always returns the caller's row.
    if (!row) throw new Error("set_coach_profile returned no row.");
    return ok(toCoachProfile(row));
  });
}
