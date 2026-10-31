// Which kind of line a start or finish reaction uses (SPEC Phase 3 step 6 and
// Phase 4 "no-guilt streaks"). Streaks only ever show positive progress: after
// a gap the character says a warm `comeback` line, and nothing ever mentions a
// lost streak or missed days. The gap is measured from the user's last
// activity of any kind (a start, a finish or a reaction), so someone who starts
// tasks every day but finishes few is not welcomed back every morning.

import type { CharacterEvent } from "@/lib/characters/content-schema";
import { addDays, daysBetween } from "./local-day";

export type TaskEventType = "started" | "finished";

/** A gap of this many local days since the last activity makes the next reaction a comeback. */
export const COMEBACK_GAP_DAYS = 2;
/** A finish streak this long or longer gets a `streak` line on the day's first finish. */
export const STREAK_LINE_MIN = 2;

export interface LineEventInput {
  eventType: TaskEventType;
  /** No reaction has been shown yet today (local day). */
  isFirstReactionOfLocalDay: boolean;
  /** This is a finish, and no other task was finished earlier today. */
  isFirstFinishOfLocalDay: boolean;
  /** Consecutive local days with a finish, counting today when it has one. */
  currentStreak: number;
  /** Local days since the user's last activity before this event (any task event or reaction); null without any. */
  daysSinceLastActivity: number | null;
  /**
   * This finish's new consistency day opened a story chapter the user did not
   * have before (see chapterUnlockedByLatestDay in ./story-unlock.ts).
   */
  unlocksChapter?: boolean;
}

export const plainLineEvent = (eventType: TaskEventType): CharacterEvent =>
  eventType === "finished" ? "task_finished" : "task_started";

/**
 * 1. comeback: the first reaction of the day after a gap of 2+ days since the
 *    last activity. Welcoming, with no guilt.
 * 2. chapter_unlocked: the first finish of a local day, when that new
 *    consistency day opened a story chapter (SPEC Phase 4).
 * 3. streak: the first finish of a local day while the streak is 2 or more.
 * 4. first_of_day: a start that is the first reaction of the local day.
 * 5. Otherwise task_started or task_finished.
 *
 * The caller falls back to the next event down when the chosen one has no
 * line (see lineEventFallbacks and selectLineWithFallback).
 */
export function chooseLineEvent(input: LineEventInput): CharacterEvent {
  const afterGap = input.daysSinceLastActivity !== null && input.daysSinceLastActivity >= COMEBACK_GAP_DAYS;
  if (afterGap && input.isFirstReactionOfLocalDay) return "comeback";
  const firstFinish = input.eventType === "finished" && input.isFirstFinishOfLocalDay;
  if (firstFinish && input.unlocksChapter) return "chapter_unlocked";
  if (firstFinish && input.currentStreak >= STREAK_LINE_MIN) return "streak";
  if (input.eventType === "started" && input.isFirstReactionOfLocalDay) return "first_of_day";
  return plainLineEvent(input.eventType);
}

/**
 * The events to try in order: the chosen one, then what would be chosen
 * without the chapter unlock (so a character without chapter_unlocked lines
 * still celebrates a streak), then the plain event.
 */
export function lineEventFallbacks(input: LineEventInput): CharacterEvent[] {
  return [...new Set([chooseLineEvent(input), chooseLineEvent({ ...input, unlocksChapter: false }), plainLineEvent(input.eventType)])];
}

/**
 * Consecutive local days with a finish, ending today, or yesterday when
 * nothing is finished yet today (a streak is not over until the day is).
 */
export function consecutiveDayStreak(finishDates: Iterable<string>, today: string): number {
  const days = new Set(finishDates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Local days from the most recent of `dates` to `today`; null when there are none. */
export function daysSinceLatest(dates: Iterable<string | null | undefined>, today: string): number | null {
  let latest: string | null = null;
  for (const date of dates) if (date && (latest === null || date > latest)) latest = date;
  return latest === null ? null : daysBetween(latest, today);
}
