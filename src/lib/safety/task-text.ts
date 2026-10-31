import "server-only";

import { logAiEvent } from "@/lib/ai/anthropic";
import { localDate, resolveTimeZone } from "@/lib/domain/local-day";
import { recordAiUsage } from "@/lib/reactions/metering";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordCrisisShown, recordDistressCheckUnavailable } from "./counters";
import { DISTRESS_MAX_SLICE_MS, createDistressDetector, isCrisisRisk } from "./distress";
import { hasDistressKeyword } from "./keywords";

// The distress check when a task's title or note is created or edited (SPEC
// Phase 3 step 1, Phase 5; PLAN D3/D4). Pivot A only: the routes call it only
// while pivot_a.enabled is on. It uses the same detector, verdict cache,
// `ai:distress` limit, metering and crisis-counter dedupe/cap as reactions and
// splits. The task is always saved first; this only decides whether the
// response tells the client to show the crisis card. Nothing about the result
// is stored, and the task text is never logged.

const detector = createDistressDetector();

/**
 * True when the title or note suggests distress: a keyword hit (no model call)
 * or a `possible`/`high` model verdict. The crisis card is counted once per
 * task per 30 minutes, within the per-user daily cap. If the model check fails
 * the keyword result stands and distress_check_unavailable goes up (D4),
 * at most five times per user per UTC day.
 * Never throws.
 */
export async function taskTextSuggestsCrisis(
  userId: string,
  task: { id: string; title: string; description: string | null },
): Promise<boolean> {
  const crisisScope = `task-text:${task.id}`;
  const text = task.description ? `${task.title}\n${task.description}` : task.title;
  if (hasDistressKeyword(text)) {
    await recordCrisisShown(crisisScope, userId);
    return true;
  }

  try {
    const admin = createAdminClient();
    // The user's local day keys the metering row and the verdict cache, so a
    // "none" here is reused by the same day's start, finish or split.
    const profile = await admin.from("user_coach_profiles").select("timezone").eq("user_id", userId).maybeSingle();
    const today = localDate(new Date(), resolveTimeZone(profile.data?.timezone));
    const distress = await detector.check(text, { userId, timeoutMs: DISTRESS_MAX_SLICE_MS, cacheScope: `${task.id}:${today}` });
    const crisis = isCrisisRisk(distress.risk);
    await Promise.all([
      crisis ? recordCrisisShown(crisisScope, userId) : null,
      recordAiUsage(admin, userId, today, { safetyChecks: distress.meter ? 1 : 0, calls: [distress.meter] }),
      distress.pendingWrites,
    ]);
    return crisis;
  } catch (error) {
    // Only a bug gets here (the detector, metering and counters never throw):
    // the keyword result stands, and the check counts as unavailable.
    logAiEvent("error", "safety", { message: "task text check failed", error: error instanceof Error ? error.name : "unknown" });
    await recordDistressCheckUnavailable(userId);
    return false;
  }
}
