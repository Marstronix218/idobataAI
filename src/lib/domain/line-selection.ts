// Choosing a prewritten line (SPEC Phase 3 step 6): match the event, the
// current streak and the task's age bucket, and avoid the user's last 20 lines.
// The choice is deterministic for a given seed (the task event id), so a retry
// of the same event shows the same line.

import { TASK_TOKEN, type CharacterEvent, type TaskAgeBucket } from "@/lib/characters/content-schema";

export interface SelectableLine {
  id: string;
  event: CharacterEvent;
  text: string;
  min_streak: number | null;
  max_streak: number | null;
  /** Null matches any task age. */
  task_age_bucket: TaskAgeBucket | null;
}

/** Lines shown this recently (by count) are skipped while anything else matches. */
export const RECENT_LINE_WINDOW = 20;
/** A title longer than this is shortened before it fills `{task}` in a line. */
export const TASK_TITLE_FILL_MAX = 60;

const DAY_MS = 86_400_000;

/** Whole days the task has existed. */
export function taskAgeDays(createdAt: string | Date, now: Date): number {
  const created = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
}

/** fresh < 1 day, days 1-6, weeks 7-29, stale >= 30 (as the character_lines column comment says). */
export function taskAgeBucket(days: number): TaskAgeBucket {
  if (days < 1) return "fresh";
  if (days < 7) return "days";
  if (days < 30) return "weeks";
  return "stale";
}

export interface LineSelectionContext {
  event: CharacterEvent;
  streak: number;
  ageBucket: TaskAgeBucket;
  /** Line ids most recent first; only the first RECENT_LINE_WINDOW count. */
  recentLineIds: readonly string[];
  /** Makes the choice repeatable, e.g. the task event id. */
  seed: string;
}

/** FNV-1a, 32-bit. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

const byId = (a: SelectableLine, b: SelectableLine) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function pick(pool: SelectableLine[], seed: string): SelectableLine {
  const sorted = [...pool].sort(byId);
  return sorted[hash(seed) % sorted.length];
}

function streakMatches(line: SelectableLine, streak: number) {
  return (line.min_streak === null || streak >= line.min_streak) && (line.max_streak === null || streak <= line.max_streak);
}

/**
 * The line to show, or null when no line matches the event, streak and age.
 * Lines written for this exact age bucket are preferred over any-age lines.
 * Lines among the last 20 shown are skipped; when every match was shown that
 * recently, the least recently used one is reused.
 */
export function selectLine(lines: readonly SelectableLine[], context: LineSelectionContext): SelectableLine | null {
  const matches = lines.filter((line) =>
    line.event === context.event
    && streakMatches(line, context.streak)
    && (line.task_age_bucket === null || line.task_age_bucket === context.ageBucket));
  if (matches.length === 0) return null;

  const recent = context.recentLineIds.slice(0, RECENT_LINE_WINDOW);
  const recentSet = new Set(recent);
  const fresh = matches.filter((line) => !recentSet.has(line.id));
  const exact = fresh.filter((line) => line.task_age_bucket === context.ageBucket);
  if (exact.length > 0) return pick(exact, context.seed);
  if (fresh.length > 0) return pick(fresh, context.seed);

  // Everything matching was shown recently: reuse the one shown longest ago.
  const lastUse = (line: SelectableLine) => recent.indexOf(line.id);
  return [...matches].sort((a, b) => lastUse(b) - lastUse(a) || byId(a, b))[0];
}

/** The first of `events` that has a matching line, with that line. */
export function selectLineWithFallback(
  lines: readonly SelectableLine[],
  events: readonly CharacterEvent[],
  context: Omit<LineSelectionContext, "event">,
): { line: SelectableLine; event: CharacterEvent } | null {
  for (const event of events) {
    const line = selectLine(lines, { ...context, event });
    if (line) return { line, event };
  }
  return null;
}

/** `title` on one line, cut at a word boundary to at most `max` characters plus an ellipsis. */
export function truncateTitle(title: string, max = TASK_TITLE_FILL_MAX): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

/** Replaces every `{task}` in a prewritten line with the (shortened) task title. */
export function fillTaskToken(text: string, title: string): string {
  return text.split(TASK_TOKEN).join(truncateTitle(title));
}
