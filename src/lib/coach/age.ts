import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AGE_CHECK_ERROR_CODES } from "@idobata/contracts";
import { ApiError, assertDatabase } from "@/lib/server/http";
import type { Database } from "@/types";

/** Whether the user's age is verified (at sign-up, or by the one-time age step for older accounts). */
export async function isAgeVerified(supabase: SupabaseClient<Database>, userId: string) {
  const row = assertDatabase(await supabase
    .from("user_coach_profiles")
    .select("age_verified_at")
    .eq("user_id", userId)
    .maybeSingle());
  return Boolean(row?.age_verified_at);
}

/**
 * Pivot A coach routes refuse an unverified user with 403 `age_requirement`,
 * so the age step cannot be skipped by calling the API directly (PLAN D6).
 * Call after the route gate and authentication. The coach profile read and
 * POST /api/coach/age stay open, so the client can show and pass the step.
 */
export async function requireAgeVerified(supabase: SupabaseClient<Database>, userId: string) {
  if (!(await isAgeVerified(supabase, userId))) {
    throw new ApiError(403, "Confirm your age to continue.", AGE_CHECK_ERROR_CODES.ageRequirement);
  }
}
