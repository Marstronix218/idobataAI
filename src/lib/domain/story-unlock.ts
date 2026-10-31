// Which story chapters a user can read (SPEC Phase 4 "Unlocking chapters").
// Chapter n needs n consistency days (local days with at least one finished
// task while the character was selected), as `unlock_rule.consistency_days`
// says. Time in the app never counts: consistency days are the only progress
// input. On top of the days, the plan decides how far the arc goes: free users
// get chapters 1-3, Plus and trial users get every chapter, and owning the
// character's pack (`pack:<slug>`) opens that character's whole arc on any
// plan. The plan comes from resolvePlan (./plan.ts).

import type { PlanTier } from "./plan";

/** Free users can read chapters 1 to this number. */
export const FREE_CHAPTER_LIMIT = 3;

export interface StoryAccess {
  /** story_progress.consistency_days for this character (0 without a row). */
  consistencyDays: number;
  tier: PlanTier;
  /** Character slugs whose pack the user owns, from resolvePlan. */
  packs: readonly string[];
  characterSlug: string;
}

export interface ChapterUnlockInput extends StoryAccess {
  chapterNumber: number;
  /** story_chapters.unlock_rule (jsonb), e.g. `{ "consistency_days": 3 }`. */
  unlockRule: unknown;
}

/**
 * Why a chapter is still locked, or null when it is readable. `days`: the
 * plan allows it and `daysNeeded` more consistency days will open it. `plan`:
 * the plan does not include it, so more days alone will not open it.
 */
export type ChapterLock = null | { reason: "days"; daysNeeded: number } | { reason: "plan" };

/** A chapter row as the unlock rules need it. */
export interface ChapterRule {
  number: number;
  unlock_rule: unknown;
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/** `unlock_rule.consistency_days` when it is a positive whole number, otherwise the chapter number. */
export function requiredConsistencyDays(chapterNumber: number, unlockRule: unknown): number {
  const days = unlockRule !== null && typeof unlockRule === "object"
    ? (unlockRule as Record<string, unknown>).consistency_days
    : undefined;
  return isPositiveInteger(days) ? days : chapterNumber;
}

function planIncludes(input: Pick<ChapterUnlockInput, "chapterNumber" | "tier" | "packs" | "characterSlug">): boolean {
  if (input.packs.includes(input.characterSlug)) return true;
  if (input.tier === "plus" || input.tier === "trial") return true;
  return input.chapterNumber <= FREE_CHAPTER_LIMIT;
}

/**
 * The lock on one chapter, or null when it is unlocked. A chapter the plan
 * does not include reports `plan` even when days are also missing, because
 * days alone would never open it.
 */
export function chapterLock(input: ChapterUnlockInput): ChapterLock {
  if (!planIncludes(input)) return { reason: "plan" };
  const required = requiredConsistencyDays(input.chapterNumber, input.unlockRule);
  const days = Math.max(0, Math.floor(input.consistencyDays));
  return days >= required ? null : { reason: "days", daysNeeded: required - days };
}

export function isChapterUnlocked(input: ChapterUnlockInput): boolean {
  return chapterLock(input) === null;
}

const lockOf = (chapter: ChapterRule, access: StoryAccess) =>
  chapterLock({ ...access, chapterNumber: chapter.number, unlockRule: chapter.unlock_rule });

/** The highest unlocked chapter number, or 0 when none is unlocked. */
export function highestUnlockedChapter(chapters: readonly ChapterRule[], access: StoryAccess): number {
  return chapters.reduce((highest, chapter) => (chapter.number > highest && lockOf(chapter, access) === null ? chapter.number : highest), 0);
}

/**
 * The chapter that the latest consistency day opened, when the user did not
 * have it before: unlocked now, its required days equal `consistencyDays`
 * (so it was still locked one day earlier), and above `unlockedThrough`
 * (story_progress.unlocked_through, so it was never recorded as unlocked).
 * The highest such chapter, or null. A chapter opened by a plan change rather
 * than by a new day is not reported here.
 */
export function chapterUnlockedByLatestDay(
  chapters: readonly ChapterRule[],
  access: StoryAccess,
  unlockedThrough: number,
): number | null {
  let found: number | null = null;
  for (const chapter of chapters) {
    if (chapter.number <= unlockedThrough || (found !== null && chapter.number <= found)) continue;
    if (requiredConsistencyDays(chapter.number, chapter.unlock_rule) !== access.consistencyDays) continue;
    if (lockOf(chapter, access) === null) found = chapter.number;
  }
  return found;
}
