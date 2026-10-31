import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Positive-only progress for the badges (SPEC Phase 4 "Streaks: show only
// positive progress"). Both numbers only ever go up: there is no current
// streak here that a missed day could reset, and nothing to lose.

export interface ConsistencySummary {
  /** Local days with at least one finished task, across every character, all time. */
  totalDays: number;
  /** story_progress.consistency_days for the selected character: 0 before its first day, null with no character selected. */
  characterDays: number | null;
}

/**
 * The user's consistency days. Server-only (service role, scoped to
 * `userId`). Throws when the database cannot be read; callers should hide the
 * badges then rather than show 0, which would look like lost progress.
 */
export async function getConsistencySummary(userId: string): Promise<ConsistencySummary> {
  const admin = createAdminClient();
  const [totalResult, profileResult] = await Promise.all([
    admin.rpc("coach_consistency_total_days", { p_user_id: userId }),
    admin.from("user_coach_profiles").select("selected_character_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (totalResult.error) throw new Error(`consistency total unavailable: ${totalResult.error.code ?? ""}`.trim());
  if (profileResult.error) throw new Error(`coach profile unavailable: ${profileResult.error.code ?? ""}`.trim());

  const totalDays = Math.max(0, Number(totalResult.data ?? 0));
  const characterId = profileResult.data?.selected_character_id;
  if (!characterId) return { totalDays, characterDays: null };

  const progress = await admin
    .from("story_progress")
    .select("consistency_days")
    .eq("user_id", userId)
    .eq("character_id", characterId)
    .maybeSingle();
  if (progress.error) throw new Error(`story progress unavailable: ${progress.error.code ?? ""}`.trim());
  return { totalDays, characterDays: progress.data?.consistency_days ?? 0 };
}
