import { z } from "zod";
import { ANALYTICS_EVENT_RATE_LIMIT, PAYWALL_SURFACES, recordCoachEvent } from "@/lib/analytics/events";
import { requireApiGate } from "@/lib/flags/route-gates";
import { authed, noContent, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The only event a client may name: `paywall_viewed`, when a Plus notice
 * (the split or story placeholder, while there is no paywall) is shown. Any
 * other name, surface or field is a 422. Kept once per user, local day and
 * surface by the database; no page, task or other content is accepted.
 */
const eventSchema = z.object({
  name: z.literal("paywall_viewed"),
  detail: z.enum(PAYWALL_SURFACES),
}).strict();

export async function POST(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user } = await authed(request);
    await enforceRateLimit(user.id, ANALYTICS_EVENT_RATE_LIMIT.bucket, ANALYTICS_EVENT_RATE_LIMIT.limit, ANALYTICS_EVENT_RATE_LIMIT.windowSeconds);
    const event = await parseJson(request, eventSchema);
    await recordCoachEvent(createAdminClient(), user.id, event);
    return noContent();
  });
}
