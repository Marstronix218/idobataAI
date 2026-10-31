import { NUDGE_RATE_LIMIT, pickSessionNudge } from "@/lib/coach/nudge";
import { requireApiGate } from "@/lib/flags/route-gates";
import { authed, ok, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

/**
 * A prewritten `session_nudge` line in which the selected character suggests
 * closing the app, or null without a character. The client asks after 10
 * minutes of foreground time in one session. Rate limited to 6 an hour.
 */
export async function GET(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    await enforceRateLimit(user.id, NUDGE_RATE_LIMIT.bucket, NUDGE_RATE_LIMIT.limit, NUDGE_RATE_LIMIT.windowSeconds);
    return ok(await pickSessionNudge(supabase, user.id));
  });
}
