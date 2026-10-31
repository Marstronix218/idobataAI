import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachProfile } from "@idobata/contracts";
import { listSelectableCharacters } from "@/lib/coach/characters";
import { assertDatabase } from "@/lib/server/http";
import type { Database, UserCoachProfile } from "@/types";

/** What the client sees of its coach profile. The experiment arm stays server-side. */
export const COACH_PROFILE_COLUMNS = "selected_character_id, timezone, age_verified_at";

export const EMPTY_COACH_PROFILE: CoachProfile = Object.freeze({ selected_character_id: null, timezone: null, age_verified_at: null });

export function toCoachProfile(row: Pick<UserCoachProfile, "selected_character_id" | "timezone" | "age_verified_at">): CoachProfile {
  return { selected_character_id: row.selected_character_id, timezone: row.timezone, age_verified_at: row.age_verified_at };
}

/** The user's coach profile; a user who has not started onboarding has no row yet. */
export async function readCoachProfile(supabase: SupabaseClient<Database>, userId: string): Promise<CoachProfile> {
  const row = assertDatabase(await supabase
    .from("user_coach_profiles")
    .select(COACH_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle());
  return row ? toCoachProfile(row) : EMPTY_COACH_PROFILE;
}

/** Onboarding is done once a character and a time zone are saved. */
export function isCoachProfileComplete(profile: Pick<CoachProfile, "selected_character_id" | "timezone">) {
  return Boolean(profile.selected_character_id && profile.timezone);
}

/**
 * Whether to send the user to onboarding (only asked under Pivot A): the age
 * is not verified yet (accounts from before the age gate, PLAN D6), or the
 * profile is incomplete and onboarding can complete it. With no character to
 * choose (an empty cast, for example before content is seeded) it cannot, so
 * the app stays open rather than locking the user out of it; the age step
 * needs no cast, so it always applies.
 */
export async function needsCoachOnboarding(supabase: SupabaseClient<Database>, userId: string) {
  const profile = await readCoachProfile(supabase, userId);
  if (!profile.age_verified_at) return true;
  if (isCoachProfileComplete(profile)) return false;
  // Only the time zone is missing: that step needs no cast.
  if (profile.selected_character_id) return true;
  return (await listSelectableCharacters(supabase, userId)).length > 0;
}
