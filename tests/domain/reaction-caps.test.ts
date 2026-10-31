import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/domain/local-day";
import {
  DEFAULT_AI_CAPS,
  aiReactionsInWindow,
  canSplit,
  chooseReactionSource,
  reactionReservation,
  readAiCaps,
  splitReservation,
  type ReactionSourceInput,
  type UsageByLocalDate,
} from "@/lib/domain/reaction-caps";
import type { PlanTier } from "@/lib/domain/plan";

const day = (reactions: number, splits = 0) => ({ reactions, splits });
const input = (overrides: Partial<ReactionSourceInput> = {}): ReactionSourceInput => ({
  arm: "ai",
  tier: "plus",
  aiConfigured: true,
  usageByLocalDate: {},
  today: "2026-10-31",
  ...overrides,
});

describe("chooseReactionSource: the experiment arm", () => {
  it.each<PlanTier>(["free", "trial", "plus"])("gives the prewritten arm prewritten reactions on the %s plan, even with no usage", (tier) => {
    expect(chooseReactionSource(input({ arm: "prewritten", tier }))).toBe("prewritten");
  });

  it.each<PlanTier>(["free", "trial", "plus"])("gives the AI arm AI on the %s plan while under the cap", (tier) => {
    expect(chooseReactionSource(input({ tier }))).toBe("ai");
  });

  it("uses prewritten when AI is not configured", () => {
    expect(chooseReactionSource(input({ aiConfigured: false }))).toBe("prewritten");
  });
});

describe("chooseReactionSource: the daily Plus and trial cap", () => {
  it.each<PlanTier>(["plus", "trial"])("allows 30 AI reactions a local day on %s, then prewritten", (tier) => {
    expect(chooseReactionSource(input({ tier, usageByLocalDate: { "2026-10-31": day(29) } }))).toBe("ai");
    expect(chooseReactionSource(input({ tier, usageByLocalDate: { "2026-10-31": day(30) } }))).toBe("prewritten");
  });

  it("only counts today: yesterday's full cap does not carry over", () => {
    expect(chooseReactionSource(input({ usageByLocalDate: { "2026-10-30": day(30) } }))).toBe("ai");
  });

  it("ignores splits when counting reactions", () => {
    expect(chooseReactionSource(input({ usageByLocalDate: { "2026-10-31": day(0, 10) } }))).toBe("ai");
  });

  it("honours a configured cap", () => {
    expect(chooseReactionSource(input({ usageByLocalDate: { "2026-10-31": day(5) }, caps: { ...DEFAULT_AI_CAPS, plusDailyReactions: 5 } }))).toBe("prewritten");
  });
});

describe("chooseReactionSource: the rolling 7-day free allowance", () => {
  const free = (usage: UsageByLocalDate, today = "2026-10-31") => chooseReactionSource(input({ tier: "free", usageByLocalDate: usage, today }));

  it("allows 3 AI reactions over the last 7 local days, then prewritten", () => {
    expect(free({ "2026-10-25": day(1), "2026-10-31": day(1) })).toBe("ai");
    expect(free({ "2026-10-25": day(1), "2026-10-28": day(1), "2026-10-31": day(1) })).toBe("prewritten");
  });

  it("frees an allowance when its day leaves the window [today-6, today]", () => {
    const usage = { "2026-10-25": day(3) };
    expect(free(usage, "2026-10-31")).toBe("prewritten"); // 10-25 is today-6
    expect(free(usage, "2026-11-01")).toBe("ai"); // now today-7
  });

  it("does not let a plus user's daily cap apply to free users or the other way round", () => {
    expect(free({ "2026-10-31": day(2) })).toBe("ai");
    expect(chooseReactionSource(input({ tier: "plus", usageByLocalDate: { "2026-10-29": day(3), "2026-10-30": day(3), "2026-10-31": day(3) } }))).toBe("ai");
  });

  it("sums the window", () => {
    expect(aiReactionsInWindow({ "2026-10-24": day(9), "2026-10-25": day(1), "2026-10-31": day(2), "2026-11-01": day(9) }, "2026-10-31", 7)).toBe(3);
  });
});

describe("caps reset at local midnight", () => {
  const usageOnOct31 = { "2026-10-31": day(30) };
  const plusAt = (instant: string, zone: string) => chooseReactionSource(input({ usageByLocalDate: usageOnOct31, today: localDate(new Date(instant), zone) }));

  it("resets at midnight in the user's zone, not UTC", () => {
    // 2026-11-01T03:30Z is still Oct 31 in Los Angeles but Nov 1 in London.
    expect(plusAt("2026-11-01T03:30:00Z", "America/Los_Angeles")).toBe("prewritten");
    expect(plusAt("2026-11-01T03:30:00Z", "Europe/London")).toBe("ai");
  });

  it("resets at local midnight on the night DST ends (America/New_York)", () => {
    // Oct 31 ends at 04:00Z (EDT); the 25-hour Nov 1 ends at 05:00Z on Nov 2 (EST).
    expect(plusAt("2026-11-01T03:59:59Z", "America/New_York")).toBe("prewritten");
    expect(plusAt("2026-11-01T04:00:00Z", "America/New_York")).toBe("ai");

    const usageOnNov1 = { "2026-11-01": day(30) };
    const at = (instant: string) => chooseReactionSource(input({ usageByLocalDate: usageOnNov1, today: localDate(new Date(instant), "America/New_York") }));
    expect(at("2026-11-02T04:59:59Z")).toBe("prewritten"); // 23:59:59 EST, still Nov 1
    expect(at("2026-11-02T05:00:00Z")).toBe("ai");
  });

  it("moves the free window by local days across the DST change", () => {
    const usage = { "2026-10-26": day(3) };
    const freeAt = (instant: string) => chooseReactionSource(input({ tier: "free", usageByLocalDate: usage, today: localDate(new Date(instant), "America/New_York") }));
    expect(freeAt("2026-11-02T04:59:59Z")).toBe("prewritten"); // Nov 1: window starts Oct 26
    expect(freeAt("2026-11-02T05:00:00Z")).toBe("ai"); // Nov 2: window starts Oct 27
  });
});

describe("reactionReservation: what reserve_ai_usage is asked for", () => {
  it.each<PlanTier>(["plus", "trial"])("reserves 30 a local day with a 60-attempt ceiling on %s", (tier) => {
    expect(reactionReservation({ arm: "ai", tier, aiConfigured: true })).toEqual({ kind: "reaction", windowDays: 1, cap: 30, attemptCeiling: 60 });
  });

  it("reserves 3 over 7 local days with an attempt ceiling of max(2 x cap, 10) on free", () => {
    expect(reactionReservation({ arm: "ai", tier: "free", aiConfigured: true })).toEqual({ kind: "reaction", windowDays: 7, cap: 3, attemptCeiling: 10 });
    expect(reactionReservation({ arm: "ai", tier: "free", aiConfigured: true, caps: { ...DEFAULT_AI_CAPS, freeWeeklyReactions: 8 } }))
      .toMatchObject({ cap: 8, attemptCeiling: 16 });
  });

  it.each<PlanTier>(["free", "trial", "plus"])("reserves nothing for the prewritten arm on %s, or without AI", (tier) => {
    expect(reactionReservation({ arm: "prewritten", tier, aiConfigured: true })).toBeNull();
    expect(reactionReservation({ arm: "ai", tier, aiConfigured: false })).toBeNull();
  });

  it("follows configured caps", () => {
    expect(reactionReservation({ arm: "ai", tier: "plus", aiConfigured: true, caps: { ...DEFAULT_AI_CAPS, plusDailyReactions: 5 } }))
      .toMatchObject({ cap: 5, attemptCeiling: 10 });
  });
});

describe("splitReservation", () => {
  it("reserves 10 a local day with a 20-attempt ceiling for plus and trial, whatever the arm", () => {
    for (const tier of ["plus", "trial"] as const) {
      expect(splitReservation({ tier })).toEqual({ ok: true, reservation: { kind: "split", windowDays: 1, cap: 10, attemptCeiling: 20 } });
    }
  });

  it("requires a paid plan", () => {
    expect(splitReservation({ tier: "free" })).toEqual({ ok: false, reason: "plan_required" });
  });
});

describe("canSplit", () => {
  it("requires a paid plan", () => {
    expect(canSplit({ tier: "free", splitsToday: 0 })).toEqual({ ok: false, reason: "plan_required" });
  });

  it.each<PlanTier>(["plus", "trial"])("allows 10 splits a local day on %s", (tier) => {
    expect(canSplit({ tier, splitsToday: 9 })).toEqual({ ok: true });
    expect(canSplit({ tier, splitsToday: 10 })).toEqual({ ok: false, reason: "split_cap_reached" });
  });
});

describe("readAiCaps", () => {
  it("defaults to 30 reactions and 10 splits a day for Plus, and 3 a week for free", () => {
    expect(readAiCaps({})).toEqual({ plusDailyReactions: 30, plusDailySplits: 10, freeWeeklyReactions: 3 });
  });

  it("reads overrides and ignores invalid ones", () => {
    expect(readAiCaps({ AI_CAP_PLUS_DAILY_REACTIONS: "50", AI_CAP_PLUS_DAILY_SPLITS: "-1", AI_CAP_FREE_WEEKLY_REACTIONS: "two" }))
      .toEqual({ plusDailyReactions: 50, plusDailySplits: 10, freeWeeklyReactions: 3 });
    expect(readAiCaps({ AI_CAP_FREE_WEEKLY_REACTIONS: "0" }).freeWeeklyReactions).toBe(0);
  });
});
