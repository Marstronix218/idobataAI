import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

// Pivot A product events the server records itself (SPEC Phase 7), through
// record_coach_product_event (20261031210000). The rest (task_started,
// task_finished, reaction_shown, chapter_unlocked, trial_started, purchase)
// are written by database triggers. First-party only and content-free: an
// event is a name, the user, a time and at most a value from a fixed list.

/** Where a Plus notice can be shown while there is no paywall (Phase 6 was skipped). */
export const PAYWALL_SURFACES = ["split", "story"] as const;
export type PaywallSurface = (typeof PAYWALL_SURFACES)[number];

/** A session_length is clamped to 0..86400 seconds; 0 records nothing. */
export const MAX_SESSION_SECONDS = 86_400;

/** POST /api/analytics/event, per user per hour. One notice view a day per surface is kept anyway. */
export const ANALYTICS_EVENT_RATE_LIMIT = { bucket: "analytics:event", limit: 60, windowSeconds: 3600 } as const;
/** POST /api/analytics/session, per user per hour: one per foreground stretch. */
export const ANALYTICS_SESSION_RATE_LIMIT = { bucket: "analytics:session", limit: 120, windowSeconds: 3600 } as const;

export type CoachProductEvent =
  | { name: "split_used" }
  | { name: "paywall_viewed"; detail: PaywallSurface }
  | { name: "session_length"; durationSeconds: number };

/** Whole seconds in 0..86400; anything that is not a finite number is 0. */
export function clampSessionSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SESSION_SECONDS, Math.max(0, Math.round(value)));
}

/**
 * Records one event for a server-verified user. Never throws and never logs
 * the user id: a metric must not fail the request it describes.
 */
export async function recordCoachEvent(admin: SupabaseClient<Database>, userId: string, event: CoachProductEvent): Promise<void> {
  try {
    const { error } = await admin.rpc("record_coach_product_event", {
      p_user_id: userId,
      p_event_name: event.name,
      p_detail: event.name === "paywall_viewed" ? event.detail : null,
      p_duration_seconds: event.name === "session_length" ? clampSessionSeconds(event.durationSeconds) : null,
    });
    if (error) console.error(JSON.stringify({ level: "error", scope: "analytics", message: `${event.name} not recorded`, code: error.code ?? null }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "analytics", message: `${event.name} not recorded`, error: error instanceof Error ? error.message : String(error) }));
  }
}
