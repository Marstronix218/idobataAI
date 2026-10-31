import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionNudge } from "@idobata/contracts";
import { TASK_TOKEN } from "@/lib/characters/content-schema";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { readDisclosureMaxGapHours, shouldShowDisclosure } from "@/lib/domain/disclosure-cadence";
import { RECENT_LINE_WINDOW, selectLine, type SelectableLine } from "@/lib/domain/line-selection";
import { resolveTimeZone } from "@/lib/domain/local-day";
import { assertDatabase } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types";

// The session nudge (SPEC Phase 4): after 10 minutes of foreground time in
// one session the client asks for a prewritten `session_nudge` line in which
// the character suggests closing the app. No AI. The line is stored as a
// character reaction (no task event), so the user's last 20 lines are avoided
// next time, and it is purged with the other reactions after 30 days. Like a
// reaction, it carries the daily AI reminder when it is the first character
// line of the user's local day (D11).

/** Nudges per user per hour; the client asks at most once per 10-minute session. */
export const NUDGE_RATE_LIMIT = { bucket: "coach:nudge", limit: 6, windowSeconds: 3600 } as const;

/**
 * A nudge is about the session, not a task or a streak, so a line's streak
 * range and task age don't apply, and a line that needs a task title
 * (`{task}`) cannot be used.
 */
function nudgeCandidates(lines: readonly SelectableLine[]): SelectableLine[] {
  return lines
    .filter((line) => !line.text.includes(TASK_TOKEN))
    .map((line) => ({ ...line, min_streak: null, max_streak: null, task_age_bucket: null }));
}

/** A nudge in the selected character's voice, or null without an active character or a usable line. */
export async function pickSessionNudge(supabase: SupabaseClient<Database>, userId: string): Promise<SessionNudge> {
  const profile = assertDatabase(await supabase
    .from("user_coach_profiles")
    .select("selected_character_id, timezone")
    .eq("user_id", userId)
    .maybeSingle());
  const characterId = profile?.selected_character_id;
  if (!characterId) return null;

  const admin = createAdminClient();
  const [characterResult, linesResult, recentResult, disclosureResult] = await Promise.all([
    // Name the columns: characters.sheet has no client grant.
    supabase.from("characters").select("id, slug, name, art_url").eq("id", characterId).eq("active", true).maybeSingle(),
    // character_lines has no client policy; the server picks the line.
    admin.from("character_lines").select("id, event, text, min_streak, max_streak, task_age_bucket")
      .eq("character_id", characterId).eq("active", true).eq("event", "session_nudge"),
    supabase.from("character_reactions").select("line_id").eq("user_id", userId).not("line_id", "is", null)
      .order("created_at", { ascending: false }).limit(RECENT_LINE_WINDOW),
    supabase.from("character_reactions").select("created_at").eq("user_id", userId).eq("disclosure_shown", true)
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const character = assertDatabase(characterResult);
  if (!character) return null;
  const lines = nudgeCandidates((assertDatabase(linesResult) ?? []) as SelectableLine[]);
  const recentLineIds = (assertDatabase(recentResult) ?? []).flatMap((row) => (row.line_id ? [row.line_id] : []));
  const lastDisclosure = (assertDatabase(disclosureResult) ?? [])[0];

  const line = selectLine(lines, { event: "session_nudge", streak: 0, ageBucket: "fresh", recentLineIds, seed: crypto.randomUUID() });
  if (!line) return null;

  // The same cadence as reactions; the open founder item on its wording and
  // cadence sits where the reaction engine applies it.
  const disclosure = shouldShowDisclosure({
    lastShownAt: lastDisclosure ? new Date(lastDisclosure.created_at) : null,
    now: new Date(),
    timeZone: resolveTimeZone(profile.timezone),
    maxGapHours: readDisclosureMaxGapHours(),
  }) ? AI_DISCLOSURE : null;

  const { error } = await admin.from("character_reactions").insert({
    user_id: userId,
    task_event_id: null,
    character_id: character.id,
    event: "session_nudge",
    source: "prewritten",
    line_id: line.id,
    text: line.text,
    disclosure_shown: disclosure !== null,
  });
  // Still worth showing: the worst case is that this line may come round again
  // sooner, or the reminder shows once more today.
  if (error) console.error(JSON.stringify({ level: "error", scope: "nudge", message: "session nudge not stored", code: error.code ?? null }));

  return { text: line.text, character: { id: character.id, slug: character.slug, name: character.name, artUrl: character.art_url }, disclosure };
}
