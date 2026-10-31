import { describe, expect, it } from "vitest";
import { PIVOT_FLAG_KEYS, resolveFlags, type PivotFlagKey } from "@/lib/domain/feature-flags";
import {
  PIVOT_FLAG_KEYS as SCRIPT_KEYS,
  describePivotFlags,
  parseFlagCommand,
  resolvePivotFlags,
} from "../../scripts/lib/pivot-flags.mjs";

// `npm run flags` keeps its own copy of the rules so it runs on plain Node.
// Every combination of absent/true/false rows (3^5) must agree with the app.
function allRowCombinations() {
  const combinations: Array<Partial<Record<PivotFlagKey, boolean>>> = [{}];
  for (const key of PIVOT_FLAG_KEYS) {
    const next: typeof combinations = [];
    for (const rows of combinations) {
      next.push(rows, { ...rows, [key]: true }, { ...rows, [key]: false });
    }
    combinations.splice(0, combinations.length, ...next);
  }
  return combinations;
}

describe("scripts/lib/pivot-flags.mjs", () => {
  it("knows the same keys as the app", () => {
    expect(SCRIPT_KEYS).toEqual([...PIVOT_FLAG_KEYS]);
  });

  it("resolves every row combination exactly like resolveFlags", () => {
    const combinations = allRowCombinations();
    expect(combinations).toHaveLength(243);
    for (const rows of combinations) {
      const app = resolveFlags(rows);
      expect(resolvePivotFlags(rows), JSON.stringify(rows)).toEqual({
        "pivot_a.enabled": app.pivotA,
        "social_feed.enabled": app.socialFeed,
        "persona_chat.enabled": app.personaChat,
        "persona_autopost.enabled": app.personaAutopost,
        "share_win.enabled": app.shareWin,
      });
    }
  });

  it("says whether each value is explicit, a default, or forced off by Pivot A", () => {
    expect(describePivotFlags({ "pivot_a.enabled": true, "persona_chat.enabled": true, "share_win.enabled": false })).toEqual([
      { key: "pivot_a.enabled", value: true, source: "explicit" },
      { key: "social_feed.enabled", value: false, source: "default" },
      { key: "persona_chat.enabled", value: false, source: "explicit (true), forced off by pivot_a.enabled" },
      { key: "persona_autopost.enabled", value: false, source: "default" },
      { key: "share_win.enabled", value: false, source: "explicit" },
    ]);
  });

  it("parses list, set and unset, and refuses unknown keys and values", () => {
    expect(parseFlagCommand([])).toEqual({ command: "list" });
    expect(parseFlagCommand(["set", "social_feed.enabled", "true"])).toEqual({ command: "set", key: "social_feed.enabled", value: true });
    expect(parseFlagCommand(["set", "pivot_a.enabled", "false"])).toEqual({ command: "set", key: "pivot_a.enabled", value: false });
    expect(parseFlagCommand(["unset", "share_win.enabled"])).toEqual({ command: "unset", key: "share_win.enabled" });

    expect(() => parseFlagCommand(["set", "AI_PERSONA_LIKES", "true"])).toThrow(/Unknown flag/);
    expect(() => parseFlagCommand(["unset", "pivot_a"])).toThrow(/Unknown flag/);
    expect(() => parseFlagCommand(["set", "share_win.enabled", "yes"])).toThrow(/true or false/);
    expect(() => parseFlagCommand(["set", "share_win.enabled"])).toThrow(/true or false/);
    expect(() => parseFlagCommand(["unset", "share_win.enabled", "false"])).toThrow(/only a flag key/);
    expect(() => parseFlagCommand(["delete", "share_win.enabled"])).toThrow(/Unknown command/);
  });
});
