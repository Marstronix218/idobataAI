import { z } from "zod";
import { ANALYTICS_SESSION_RATE_LIMIT, clampSessionSeconds, recordCoachEvent } from "@/lib/analytics/events";
import { requireApiGate } from "@/lib/flags/route-gates";
import { authed, noContent, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/** Seconds of foreground time; anything else (page, task, timestamps) is a 422. */
const sessionSchema = z.object({ durationSeconds: z.number().finite() }).strict();

/**
 * One foreground stretch from the app shell's session tracker, sent when the
 * page is hidden or closed (fetch with keepalive and the usual bearer token).
 * Clamped to 0..86400 seconds; 0 records nothing. The database folds stretches
 * less than 30 minutes apart into one session_length row.
 */
export async function POST(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user } = await authed(request);
    await enforceRateLimit(user.id, ANALYTICS_SESSION_RATE_LIMIT.bucket, ANALYTICS_SESSION_RATE_LIMIT.limit, ANALYTICS_SESSION_RATE_LIMIT.windowSeconds);
    const durationSeconds = clampSessionSeconds((await parseJson(request, sessionSchema)).durationSeconds);
    if (durationSeconds > 0) await recordCoachEvent(createAdminClient(), user.id, { name: "session_length", durationSeconds });
    return noContent();
  });
}
