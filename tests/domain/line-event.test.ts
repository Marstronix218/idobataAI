import { describe, expect, it } from "vitest";
import { chooseLineEvent, consecutiveDayStreak, daysSinceLatest, type LineEventInput } from "@/lib/domain/line-event";
import { findBannedContent } from "@/lib/characters/banned-content";
import { sampleLines } from "../helpers/pivot-fixtures";

const input = (overrides: Partial<LineEventInput> = {}): LineEventInput => ({
  eventType: "started",
  isFirstReactionOfLocalDay: false,
  isFirstFinishOfLocalDay: false,
  currentStreak: 0,
  daysSinceLastActivity: 1,
  ...overrides,
});

describe("chooseLineEvent", () => {
  it("uses the plain event by default", () => {
    expect(chooseLineEvent(input())).toBe("task_started");
    expect(chooseLineEvent(input({ eventType: "finished" }))).toBe("task_finished");
  });

  it("uses first_of_day for the day's first reaction when it is a start", () => {
    expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true }))).toBe("first_of_day");
  });

  it("uses streak on the day's first finish while the streak is 2 or more", () => {
    expect(chooseLineEvent(input({ eventType: "finished", isFirstFinishOfLocalDay: true, currentStreak: 2 }))).toBe("streak");
    expect(chooseLineEvent(input({ eventType: "finished", isFirstFinishOfLocalDay: true, currentStreak: 1 }))).toBe("task_finished");
    expect(chooseLineEvent(input({ eventType: "finished", isFirstFinishOfLocalDay: false, currentStreak: 5 }))).toBe("task_finished");
    expect(chooseLineEvent(input({ eventType: "finished", isFirstReactionOfLocalDay: true, isFirstFinishOfLocalDay: true, currentStreak: 3 }))).toBe("streak");
  });

  describe("the no-guilt comeback", () => {
    it("welcomes the user back on the first reaction after a gap of 2+ days, start or finish", () => {
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true, daysSinceLastActivity: 2 }))).toBe("comeback");
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true, daysSinceLastActivity: 30 }))).toBe("comeback");
      expect(chooseLineEvent(input({ eventType: "finished", isFirstReactionOfLocalDay: true, isFirstFinishOfLocalDay: true, daysSinceLastActivity: 4, currentStreak: 1 }))).toBe("comeback");
    });

    it("says it only once: later reactions that day are ordinary", () => {
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: false, daysSinceLastActivity: 5 }))).toBe("task_started");
    });

    it("does not treat yesterday's activity, or a brand-new user, as a gap", () => {
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true, daysSinceLastActivity: 1 }))).toBe("first_of_day");
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true, daysSinceLastActivity: null }))).toBe("first_of_day");
    });

    it("measures the gap from any activity, so a daily starter who rarely finishes is not welcomed back daily", () => {
      // Last finish 5 days ago, but a start yesterday.
      const daysSinceLastActivity = daysSinceLatest(["2026-10-26", "2026-10-30"], "2026-10-31");
      expect(daysSinceLastActivity).toBe(1);
      expect(chooseLineEvent(input({ isFirstReactionOfLocalDay: true, daysSinceLastActivity }))).toBe("first_of_day");
    });

    it("has comeback lines that never mention missed days or lost streaks", () => {
      const comebacks = sampleLines.filter((line) => line.event === "comeback").map((line) => String(line.text));
      expect(comebacks.length).toBeGreaterThan(0);
      for (const text of comebacks) {
        expect(findBannedContent(text)).toEqual([]);
        expect(text).not.toMatch(/\b(missed|lost|broke|broken|streak|disappoint)/i);
      }
    });
  });
});

describe("consecutiveDayStreak", () => {
  it("counts consecutive local days ending today", () => {
    expect(consecutiveDayStreak(["2026-10-31", "2026-10-30", "2026-10-29", "2026-10-27"], "2026-10-31")).toBe(3);
  });

  it("keeps yesterday's streak alive until today ends", () => {
    expect(consecutiveDayStreak(["2026-10-30", "2026-10-29"], "2026-10-31")).toBe(2);
  });

  it("is zero after a gap, and counts a day with several finishes once", () => {
    expect(consecutiveDayStreak(["2026-10-29"], "2026-10-31")).toBe(0);
    expect(consecutiveDayStreak(["2026-10-31", "2026-10-31", "2026-10-31"], "2026-10-31")).toBe(1);
    expect(consecutiveDayStreak([], "2026-10-31")).toBe(0);
  });

  it("crosses month boundaries", () => {
    expect(consecutiveDayStreak(["2026-11-01", "2026-10-31", "2026-10-30"], "2026-11-01")).toBe(3);
  });
});

describe("daysSinceLatest", () => {
  it("measures local days from the latest date, ignoring missing ones", () => {
    expect(daysSinceLatest(["2026-10-25", "2026-10-28"], "2026-10-31")).toBe(3);
    expect(daysSinceLatest([null, "2026-10-29", undefined], "2026-10-31")).toBe(2);
    expect(daysSinceLatest([], "2026-10-31")).toBeNull();
    expect(daysSinceLatest([null], "2026-10-31")).toBeNull();
  });
});
