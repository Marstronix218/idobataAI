import "server-only";

import { enforceRateLimit } from "@/lib/server/rate-limit";

/** Reactions to starts and finishes per user per hour (shared bucket). */
export const REACTION_RATE_LIMIT = { bucket: "tasks:reaction", limit: 120, windowSeconds: 3600 } as const;

/**
 * Whether the user may get another start/finish reaction this hour. It never
 * blocks the task change itself: the routes start or complete the task first
 * and only skip the reaction when this says no, including when the limiter is
 * unavailable.
 */
export async function reactionRateLimitAllows(userId: string): Promise<boolean> {
  try {
    await enforceRateLimit(userId, REACTION_RATE_LIMIT.bucket, REACTION_RATE_LIMIT.limit, REACTION_RATE_LIMIT.windowSeconds);
    return true;
  } catch {
    return false;
  }
}
