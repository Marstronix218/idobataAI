// Pivot A flag rules. `public.pivot_flag_enabled()` in SQL mirrors
// `resolveFlags()` exactly, and `scripts/lib/pivot-flags.mjs` duplicates it for
// `npm run flags`; tests hold all three to the same matrix.

export const PIVOT_FLAG_KEYS = [
  "pivot_a.enabled",
  "social_feed.enabled",
  "persona_chat.enabled",
  "persona_autopost.enabled",
  "share_win.enabled",
  "beta_full_access.enabled",
] as const;

export type PivotFlagKey = (typeof PIVOT_FLAG_KEYS)[number];

export interface PivotFlags {
  pivotA: boolean;
  socialFeed: boolean;
  personaChat: boolean;
  personaAutopost: boolean;
  shareWin: boolean;
  /** Shared wins get no persona engagement and the composer starts at "Only me" (D9, D10). */
  sharePeopleOnly: boolean;
  /**
   * Free beta (founder decision 2026-10-31): with Pivot A on, every user gets
   * Plus-level access (src/lib/coach/plan.ts). Its row alone decides it; a
   * missing row means off, and no guardrail rule touches it.
   */
  betaFullAccess: boolean;
}

/** `rows` holds the stored `app_feature_flags` values; a missing key means the row is absent. */
export function resolveFlags(rows: Partial<Record<PivotFlagKey, boolean>>): PivotFlags {
  const pivotA = rows["pivot_a.enabled"] ?? false;
  return {
    pivotA,
    socialFeed: rows["social_feed.enabled"] ?? !pivotA,
    // Guardrails (D13): Pivot A forces these off whatever their row says.
    personaChat: pivotA ? false : rows["persona_chat.enabled"] ?? true,
    personaAutopost: pivotA ? false : rows["persona_autopost.enabled"] ?? true,
    shareWin: rows["share_win.enabled"] ?? true,
    sharePeopleOnly: pivotA,
    betaFullAccess: rows["beta_full_access.enabled"] ?? false,
  };
}

/** Today's product: every surface on. */
export const LEGACY_FLAGS: PivotFlags = Object.freeze(resolveFlags({}));

/**
 * Served when the flags have never been read on this server instance and the
 * read fails: today's product, except that the persona guardrails fail closed.
 */
export const FAILSAFE_FLAGS: PivotFlags = Object.freeze({ ...LEGACY_FLAGS, personaChat: false, personaAutopost: false });

export type RouteGate =
  | "pivot_a"
  | "social_feed"
  | "persona_chat"
  | "persona_autopost"
  | "persona_engagement"
  | "share_win"
  | "wins"
  | "chat"
  | "always";

export function isGateOpen(flags: PivotFlags, gate: RouteGate): boolean {
  switch (gate) {
    // Character Coach surfaces: character pick, profiles and the coach profile.
    case "pivot_a": return flags.pivotA;
    case "social_feed": return flags.socialFeed;
    case "persona_chat": return flags.personaChat;
    case "persona_autopost": return flags.personaAutopost;
    // Persona likes, replies and reposts on people's posts. Pivot A stops them
    // (D9); with it off, the SQL AI_PERSONA_* flags decide what gets queued.
    case "persona_engagement": return !flags.pivotA;
    case "share_win": return flags.shareWin;
    // D10: a people-only Wins view stays when the full feed is off but sharing is on.
    case "wins": return flags.socialFeed || flags.shareWin;
    // The chat route stays open for either thread kind; each thread is checked inside.
    case "chat": return flags.socialFeed || flags.personaChat;
    case "always": return true;
  }
}
