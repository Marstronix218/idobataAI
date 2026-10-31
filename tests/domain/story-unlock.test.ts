import { describe, expect, it } from "vitest";
import { resolvePlan, type EntitlementRow } from "@/lib/domain/plan";
import {
  FREE_CHAPTER_LIMIT,
  chapterLock,
  chapterUnlockedByLatestDay,
  highestUnlockedChapter,
  isChapterUnlocked,
  requiredConsistencyDays,
  type ChapterRule,
  type ChapterUnlockInput,
  type StoryAccess,
} from "@/lib/domain/story-unlock";

const NOW = new Date("2026-10-31T12:00:00Z");
const entitlement = (overrides: Partial<EntitlementRow>): EntitlementRow => ({ product: "plus", status: "active", trial_ends_at: null, current_period_end: null, ...overrides });
const planFor = (rows: EntitlementRow[]) => resolvePlan(rows, NOW);

const input = (overrides: Partial<ChapterUnlockInput> = {}): ChapterUnlockInput => ({
  chapterNumber: 1,
  unlockRule: { consistency_days: overrides.chapterNumber ?? 1 },
  consistencyDays: 0,
  tier: "free",
  packs: [],
  characterSlug: "sample-coach",
  ...overrides,
});

/** Chapters 1..n with the content rule: chapter n unlocks at n consistency days. */
const arc = (count: number): ChapterRule[] => Array.from({ length: count }, (_, index) => ({ number: index + 1, unlock_rule: { consistency_days: index + 1 } }));
const access = (overrides: Partial<StoryAccess> = {}): StoryAccess => ({ consistencyDays: 0, tier: "free", packs: [], characterSlug: "sample-coach", ...overrides });

describe("requiredConsistencyDays", () => {
  it("reads unlock_rule.consistency_days", () => {
    expect(requiredConsistencyDays(2, { consistency_days: 2 })).toBe(2);
    expect(requiredConsistencyDays(2, { consistency_days: 5 })).toBe(5);
  });

  it("falls back to the chapter number for a missing or malformed rule", () => {
    for (const rule of [{}, null, undefined, "3", [], { consistency_days: 0 }, { consistency_days: -1 }, { consistency_days: 1.5 }, { consistency_days: "4" }, { minutes_in_app: 1 }]) {
      expect(requiredConsistencyDays(4, rule), JSON.stringify(rule)).toBe(4);
    }
  });
});

describe("chapter unlock rules", () => {
  it("unlocks chapter n at n consistency days", () => {
    expect(chapterLock(input({ chapterNumber: 1, consistencyDays: 0 }))).toEqual({ reason: "days", daysNeeded: 1 });
    expect(chapterLock(input({ chapterNumber: 1, consistencyDays: 1 }))).toBeNull();
    expect(chapterLock(input({ chapterNumber: 3, consistencyDays: 1 }))).toEqual({ reason: "days", daysNeeded: 2 });
    expect(chapterLock(input({ chapterNumber: 3, consistencyDays: 3 }))).toBeNull();
    expect(isChapterUnlocked(input({ chapterNumber: 2, consistencyDays: 7 }))).toBe(true);
  });

  it("gives free users chapters 1-3 only", () => {
    expect(FREE_CHAPTER_LIMIT).toBe(3);
    const free = planFor([]);
    for (const chapterNumber of [1, 2, 3]) {
      expect(chapterLock(input({ chapterNumber, consistencyDays: 30, ...free }))).toBeNull();
    }
    for (const chapterNumber of [4, 5, 30]) {
      expect(chapterLock(input({ chapterNumber, consistencyDays: 30, ...free }))).toEqual({ reason: "plan" });
    }
  });

  it("reports the plan, not days, for a chapter the plan excludes, since days alone would never open it", () => {
    expect(chapterLock(input({ chapterNumber: 5, consistencyDays: 1 }))).toEqual({ reason: "plan" });
  });

  it("gives Plus and trial users every chapter, once the days are there", () => {
    for (const plan of [planFor([entitlement({})]), planFor([entitlement({ status: "trialing", trial_ends_at: "2026-11-14T00:00:00Z" })])]) {
      expect(["plus", "trial"]).toContain(plan.tier);
      expect(chapterLock(input({ chapterNumber: 30, consistencyDays: 30, ...plan }))).toBeNull();
      expect(chapterLock(input({ chapterNumber: 30, consistencyDays: 12, ...plan }))).toEqual({ reason: "days", daysNeeded: 18 });
    }
  });

  it("opens the character's full arc for the owner of its pack, on the free plan", () => {
    const plan = planFor([entitlement({ product: "pack:sample-coach" })]);
    expect(plan).toEqual({ tier: "free", packs: ["sample-coach"] });
    expect(chapterLock(input({ chapterNumber: 12, consistencyDays: 12, ...plan }))).toBeNull();
    expect(chapterLock(input({ chapterNumber: 12, consistencyDays: 11, ...plan }))).toEqual({ reason: "days", daysNeeded: 1 });
  });

  it("does not let one character's pack open another character's arc", () => {
    const plan = planFor([entitlement({ product: "pack:other-character" })]);
    expect(chapterLock(input({ chapterNumber: 4, consistencyDays: 10, ...plan }))).toEqual({ reason: "plan" });
  });

  it("ignores a pack that is not active, as resolvePlan does", () => {
    const plan = planFor([entitlement({ product: "pack:sample-coach", status: "refunded" })]);
    expect(chapterLock(input({ chapterNumber: 4, consistencyDays: 10, ...plan }))).toEqual({ reason: "plan" });
  });

  it("always needs the days, on every plan: buying never skips them", () => {
    for (const plan of [planFor([]), planFor([entitlement({})]), planFor([entitlement({ product: "pack:sample-coach" })])]) {
      expect(chapterLock(input({ chapterNumber: 2, consistencyDays: 1, ...plan }))).toEqual({ reason: "days", daysNeeded: 1 });
      expect(chapterLock(input({ chapterNumber: 1, consistencyDays: 0, ...plan }))).toEqual({ reason: "days", daysNeeded: 1 });
    }
  });

  it("unlocks by consistency days only, never by time in the app", () => {
    // Nothing but consistency days moves a chapter: no rule key for time in
    // the app, sessions or minutes is read, and such a rule falls back to the
    // chapter number of days.
    const timeRule = { minutes_in_app: 0, sessions: 0, seconds_foreground: 0 };
    expect(chapterLock(input({ chapterNumber: 2, unlockRule: timeRule, consistencyDays: 0, tier: "plus" }))).toEqual({ reason: "days", daysNeeded: 2 });
    expect(chapterLock(input({ chapterNumber: 2, unlockRule: timeRule, consistencyDays: 2, tier: "plus" }))).toBeNull();
    // The input has no time field at all; extra fields change nothing.
    const withTime = { ...input({ chapterNumber: 2, consistencyDays: 0, tier: "plus" }), minutesInApp: 10_000 } as ChapterUnlockInput;
    expect(chapterLock(withTime)).toEqual({ reason: "days", daysNeeded: 2 });
  });

  it("treats fractional or negative day counts safely", () => {
    expect(chapterLock(input({ chapterNumber: 1, consistencyDays: 0.9 }))).toEqual({ reason: "days", daysNeeded: 1 });
    expect(chapterLock(input({ chapterNumber: 1, consistencyDays: -3 }))).toEqual({ reason: "days", daysNeeded: 1 });
  });
});

describe("highestUnlockedChapter", () => {
  it("is the highest open chapter, or 0", () => {
    expect(highestUnlockedChapter(arc(5), access({ consistencyDays: 0 }))).toBe(0);
    expect(highestUnlockedChapter(arc(5), access({ consistencyDays: 2 }))).toBe(2);
    expect(highestUnlockedChapter(arc(5), access({ consistencyDays: 9 }))).toBe(3);
    expect(highestUnlockedChapter(arc(5), access({ consistencyDays: 9, tier: "plus" }))).toBe(5);
    expect(highestUnlockedChapter([], access({ consistencyDays: 9, tier: "plus" }))).toBe(0);
  });
});

describe("chapterUnlockedByLatestDay", () => {
  it("reports the chapter the latest consistency day opened", () => {
    expect(chapterUnlockedByLatestDay(arc(5), access({ consistencyDays: 2 }), 1)).toBe(2);
    expect(chapterUnlockedByLatestDay(arc(5), access({ consistencyDays: 4, tier: "plus" }), 3)).toBe(4);
  });

  it("reports nothing the user already had", () => {
    expect(chapterUnlockedByLatestDay(arc(5), access({ consistencyDays: 2 }), 2)).toBeNull();
    expect(chapterUnlockedByLatestDay(arc(5), access({ consistencyDays: 2 }), 5)).toBeNull();
  });

  it("reports nothing on a day past the free chapters, and nothing past the end of the arc", () => {
    expect(chapterUnlockedByLatestDay(arc(5), access({ consistencyDays: 4 }), 3)).toBeNull();
    expect(chapterUnlockedByLatestDay(arc(3), access({ consistencyDays: 4, tier: "plus" }), 3)).toBeNull();
  });

  it("does not announce chapters a plan change opened, only the one today's day opened", () => {
    // Upgraded at 10 days with chapters 1-3 recorded: 4-9 opened by the plan, 10 by today.
    expect(chapterUnlockedByLatestDay(arc(12), access({ consistencyDays: 10, tier: "plus" }), 3)).toBe(10);
    // Before Phase 4 nothing was recorded; day 6 on the free plan opens nothing new.
    expect(chapterUnlockedByLatestDay(arc(12), access({ consistencyDays: 6 }), 0)).toBeNull();
  });

  it("opens the pack's full arc for its owner day by day", () => {
    expect(chapterUnlockedByLatestDay(arc(30), access({ consistencyDays: 7, packs: ["sample-coach"] }), 6)).toBe(7);
  });
});
