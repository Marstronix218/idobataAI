import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactionCharacter, StoryChapterContent, StoryOverview } from "@idobata/contracts";
import type { EntitlementRow } from "@/lib/domain/plan";
import { chapterLock, highestUnlockedChapter, type StoryAccess } from "@/lib/domain/story-unlock";
import { assertDatabase } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types";
import { resolveEffectivePlan } from "./plan";

// The story (SPEC Phase 4): the selected character's chapters, unlocked by
// consistency days and the plan (src/lib/domain/story-unlock.ts). Everything
// about the user (profile, character, progress, plan) is read with the
// caller's own client, so RLS also keeps it to their rows. story_chapters has
// no client policy: the service role reads titles and unlock rules first, and
// a body only once the lock is worked out and the chapter is open.

type Client = SupabaseClient<Database>;
type AdminClient = ReturnType<typeof createAdminClient>;

/** GET /api/story and GET /api/story/[number] share one bucket per user. */
export const STORY_RATE_LIMIT = { bucket: "story:read", limit: 240, windowSeconds: 3600 } as const;

interface StoryContext {
  characterId: string;
  character: ReactionCharacter;
  access: StoryAccess;
  unlockedThrough: number;
}

/** The selected, active character with the caller's progress on it and their plan; null when there is none. */
async function loadStoryContext(supabase: Client, userId: string, now: Date): Promise<StoryContext | null> {
  const profile = assertDatabase(await supabase
    .from("user_coach_profiles")
    .select("selected_character_id")
    .eq("user_id", userId)
    .maybeSingle());
  const characterId = profile?.selected_character_id;
  if (!characterId) return null;

  const [characterResult, progressResult, entitlementResult] = await Promise.all([
    // Name the columns: characters.sheet has no client grant.
    supabase.from("characters").select("id, slug, name, art_url").eq("id", characterId).eq("active", true).maybeSingle(),
    supabase.from("story_progress").select("consistency_days, unlocked_through")
      .eq("user_id", userId).eq("character_id", characterId).maybeSingle(),
    supabase.from("entitlements").select("product, status, trial_ends_at, current_period_end").eq("user_id", userId),
  ]);
  const character = assertDatabase(characterResult);
  if (!character) return null;
  const progress = assertDatabase(progressResult);
  // Entitlements, or Plus for everyone during the free beta: every chapter, still by consistency days.
  const plan = await resolveEffectivePlan((assertDatabase(entitlementResult) ?? []) as EntitlementRow[], now);
  return {
    characterId: character.id,
    character: { id: character.id, slug: character.slug, name: character.name, artUrl: character.art_url },
    access: { consistencyDays: progress?.consistency_days ?? 0, tier: plan.tier, packs: plan.packs, characterSlug: character.slug },
    unlockedThrough: progress?.unlocked_through ?? 0,
  };
}

/**
 * Raises story_progress.unlocked_through to `number` when it is lower, so it
 * only ever records the highest chapter opened. Never lowers it, never
 * throws: a failure is logged and the next read tries again.
 */
export async function recordUnlockedThrough(admin: AdminClient, userId: string, characterId: string, number: number): Promise<void> {
  if (number < 1) return;
  try {
    const { error } = await admin
      .from("story_progress")
      .update({ unlocked_through: number })
      .eq("user_id", userId)
      .eq("character_id", characterId)
      .lt("unlocked_through", number);
    if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "story", message: "unlocked_through not stored", error: error instanceof Error ? error.message : String(error) }));
  }
}

/** The selected character's chapters with their locks; never a body. */
export async function readStoryOverview(supabase: Client, userId: string, now = new Date()): Promise<StoryOverview> {
  const context = await loadStoryContext(supabase, userId, now);
  if (!context) return { character: null, consistencyDays: 0, chapters: [] };

  const admin = createAdminClient();
  const rows = assertDatabase(await admin
    .from("story_chapters")
    .select("number, title, unlock_rule")
    .eq("character_id", context.characterId)
    .eq("active", true)
    .order("number", { ascending: true })) ?? [];

  const chapters = rows.map((row) => {
    const lock = chapterLock({ ...context.access, chapterNumber: row.number, unlockRule: row.unlock_rule });
    return { number: row.number, title: row.title, unlocked: lock === null, lock };
  });
  const highest = highestUnlockedChapter(rows, context.access);
  if (highest > context.unlockedThrough) await recordUnlockedThrough(admin, userId, context.characterId, highest);

  return { character: context.character, consistencyDays: context.access.consistencyDays, chapters };
}

/** One chapter of the selected character, or null when it is missing, retired or locked for this user. */
export async function readStoryChapter(supabase: Client, userId: string, number: number, now = new Date()): Promise<StoryChapterContent | null> {
  const context = await loadStoryContext(supabase, userId, now);
  if (!context) return null;

  const admin = createAdminClient();
  const chapter = assertDatabase(await admin
    .from("story_chapters")
    .select("number, title, unlock_rule")
    .eq("character_id", context.characterId)
    .eq("number", number)
    .eq("active", true)
    .maybeSingle());
  if (!chapter) return null;
  if (chapterLock({ ...context.access, chapterNumber: chapter.number, unlockRule: chapter.unlock_rule }) !== null) return null;

  // Only now, with the chapter known to be open, is its body read.
  const content = assertDatabase(await admin
    .from("story_chapters")
    .select("body")
    .eq("character_id", context.characterId)
    .eq("number", chapter.number)
    .eq("active", true)
    .maybeSingle());
  if (!content) return null;
  if (chapter.number > context.unlockedThrough) await recordUnlockedThrough(admin, userId, context.characterId, chapter.number);

  return { number: chapter.number, title: chapter.title, body: content.body };
}
