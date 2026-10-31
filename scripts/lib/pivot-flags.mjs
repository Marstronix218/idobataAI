// A copy of resolveFlags() in src/lib/domain/feature-flags.ts, so `npm run
// flags` runs on plain Node without importing TypeScript.
// tests/domain/pivot-flags-script.test.ts keeps the two identical.

export const PIVOT_FLAG_KEYS = [
  "pivot_a.enabled",
  "social_feed.enabled",
  "persona_chat.enabled",
  "persona_autopost.enabled",
  "share_win.enabled",
];

/** Guardrails (D13): Pivot A forces these off whatever their row says. */
const FORCED_OFF_UNDER_PIVOT = new Set(["persona_chat.enabled", "persona_autopost.enabled"]);

/**
 * @param {Partial<Record<string, boolean>>} rows stored values; a missing key means no row
 * @returns {Record<string, boolean>} the effective value of every Pivot A flag
 */
export function resolvePivotFlags(rows) {
  const pivot = rows["pivot_a.enabled"] ?? false;
  return {
    "pivot_a.enabled": pivot,
    "social_feed.enabled": rows["social_feed.enabled"] ?? !pivot,
    "persona_chat.enabled": pivot ? false : rows["persona_chat.enabled"] ?? true,
    "persona_autopost.enabled": pivot ? false : rows["persona_autopost.enabled"] ?? true,
    "share_win.enabled": rows["share_win.enabled"] ?? true,
  };
}

/**
 * One line per flag for `npm run flags`.
 * @param {Partial<Record<string, boolean>>} rows
 */
export function describePivotFlags(rows) {
  const effective = resolvePivotFlags(rows);
  const pivot = effective["pivot_a.enabled"];
  return PIVOT_FLAG_KEYS.map((key) => {
    const stored = rows[key];
    let source = "default";
    if (stored !== undefined) {
      source = pivot && FORCED_OFF_UNDER_PIVOT.has(key) && stored !== effective[key]
        ? `explicit (${stored}), forced off by pivot_a.enabled`
        : "explicit";
    }
    return { key, value: effective[key], source };
  });
}

/**
 * @param {string[]} args the arguments after `npm run flags --`
 * @returns {{ command: "list" } | { command: "set"; key: string; value: boolean } | { command: "unset"; key: string }}
 */
export function parseFlagCommand(args) {
  const [command, key, value, ...rest] = args;
  if (!command) return { command: "list" };
  if (command !== "set" && command !== "unset") throw new Error(`Unknown command "${command}". Use: flags, flags set <key> <true|false>, flags unset <key>.`);
  if (!key || !PIVOT_FLAG_KEYS.includes(key)) throw new Error(`Unknown flag "${key ?? ""}". Known flags: ${PIVOT_FLAG_KEYS.join(", ")}.`);
  if (command === "unset") {
    if (value !== undefined) throw new Error("unset takes only a flag key.");
    return { command, key };
  }
  if ((value !== "true" && value !== "false") || rest.length) throw new Error("set takes a flag key and true or false.");
  return { command, key, value: value === "true" };
}
