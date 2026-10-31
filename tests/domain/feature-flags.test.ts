import { describe, expect, it } from "vitest";
import { FAILSAFE_FLAGS, LEGACY_FLAGS, PIVOT_FLAG_KEYS, resolveFlags, type PivotFlagKey, type PivotFlags } from "@/lib/domain/feature-flags";

type Stored = "absent" | true | false;
const STORED: Stored[] = ["absent", true, false];

// The expected effective value of each dependent flag, written out by hand from
// PLAN.md §3 rather than derived from the implementation.
const EXPECTED: Record<Exclude<PivotFlagKey, "pivot_a.enabled">, { field: keyof PivotFlags; off: Record<string, boolean>; on: Record<string, boolean> }> = {
  "social_feed.enabled": { field: "socialFeed", off: { absent: true, true: true, false: false }, on: { absent: false, true: true, false: false } },
  "persona_chat.enabled": { field: "personaChat", off: { absent: true, true: true, false: false }, on: { absent: false, true: false, false: false } },
  "persona_autopost.enabled": { field: "personaAutopost", off: { absent: true, true: true, false: false }, on: { absent: false, true: false, false: false } },
  "share_win.enabled": { field: "shareWin", off: { absent: true, true: true, false: false }, on: { absent: true, true: true, false: false } },
};

function rowsFor(pivot: Stored, key?: PivotFlagKey, stored?: Stored) {
  const rows: Partial<Record<PivotFlagKey, boolean>> = {};
  if (pivot !== "absent") rows["pivot_a.enabled"] = pivot;
  if (key && stored !== undefined && stored !== "absent") rows[key] = stored;
  return rows;
}

describe("resolveFlags", () => {
  it("keeps today's product when no row exists", () => {
    expect(resolveFlags({})).toEqual({
      pivotA: false,
      socialFeed: true,
      personaChat: true,
      personaAutopost: true,
      shareWin: true,
      sharePeopleOnly: false,
    });
    expect(LEGACY_FLAGS).toEqual(resolveFlags({}));
    expect(Object.isFrozen(LEGACY_FLAGS)).toBe(true);
  });

  for (const pivot of STORED) {
    const mode = pivot === true ? "on" : "off";
    it(`reads pivot_a.enabled ${String(pivot)} as Pivot A ${mode}`, () => {
      const flags = resolveFlags(rowsFor(pivot));
      expect(flags.pivotA).toBe(pivot === true);
      expect(flags.sharePeopleOnly).toBe(pivot === true);
    });

    for (const [key, expected] of Object.entries(EXPECTED) as Array<[PivotFlagKey, (typeof EXPECTED)[keyof typeof EXPECTED]]>) {
      for (const stored of STORED) {
        it(`pivot ${String(pivot)}: ${key} ${String(stored)} -> ${expected[mode][String(stored)]}`, () => {
          expect(resolveFlags(rowsFor(pivot, key, stored))[expected.field]).toBe(expected[mode][String(stored)]);
        });
      }
    }
  }

  it("never lets a row re-enable persona chat or autoposting under Pivot A (D13)", () => {
    const flags = resolveFlags({
      "pivot_a.enabled": true,
      "persona_chat.enabled": true,
      "persona_autopost.enabled": true,
      "social_feed.enabled": true,
      "share_win.enabled": true,
    });
    expect(flags.personaChat).toBe(false);
    expect(flags.personaAutopost).toBe(false);
    expect(flags.socialFeed).toBe(true);
    expect(flags.sharePeopleOnly).toBe(true);
  });

  it("lets every guardrail be switched off while Pivot A is off", () => {
    expect(resolveFlags({ "persona_chat.enabled": false, "persona_autopost.enabled": false })).toMatchObject({
      pivotA: false,
      personaChat: false,
      personaAutopost: false,
      socialFeed: true,
    });
  });

  it("fails closed on the persona guardrails when flags cannot be read", () => {
    expect(FAILSAFE_FLAGS).toEqual({
      pivotA: false,
      socialFeed: true,
      personaChat: false,
      personaAutopost: false,
      shareWin: true,
      sharePeopleOnly: false,
    });
    expect(Object.isFrozen(FAILSAFE_FLAGS)).toBe(true);
  });

  it("lists exactly the five Pivot A keys", () => {
    expect([...PIVOT_FLAG_KEYS].sort()).toEqual([
      "persona_autopost.enabled",
      "persona_chat.enabled",
      "pivot_a.enabled",
      "share_win.enabled",
      "social_feed.enabled",
    ]);
  });
});
