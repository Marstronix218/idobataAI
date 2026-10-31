import { ageCheckInputSchema } from "@idobata/contracts";
import { requireAdult } from "@/lib/age/check";
import { toCoachProfile } from "@/lib/coach/profile";
import { requireApiGate } from "@/lib/flags/route-gates";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

/**
 * The one-time age step for an account created before the age gate (PLAN
 * D6). Runs the AgeVerifier on the date of birth, which is never stored, and
 * on a pass records the time and method on the caller's coach profile (an
 * earlier verification is kept). Under 18 answers 403 `age_requirement` and
 * stores nothing. `set_coach_age_verified` is service-role only, so this route
 * is the only way to record a verification.
 */
export async function POST(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user } = await authed(request);
    await enforceRateLimit(user.id, "coach:age", 10, 3600);
    const input = await parseJson(request, ageCheckInputSchema);
    const method = await requireAdult(input);

    const row = assertDatabase(await createAdminClient().rpc("set_coach_age_verified", { p_user_id: user.id, p_method: method }));
    // The upsert always returns the caller's row.
    if (!row) throw new Error("set_coach_age_verified returned no row.");
    return ok(toCoachProfile(row));
  });
}
