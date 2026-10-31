import { z } from "zod";
import { requireAgeVerified } from "@/lib/coach/age";
import { readStoryChapter, STORY_RATE_LIMIT } from "@/lib/coach/story";
import { requireApiGate } from "@/lib/flags/route-gates";
import { ApiError, authed, ok, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

/** A chapter number: a positive whole number with no sign, leading zero or exponent. */
const numberSchema = z.string().regex(/^[1-9][0-9]{0,8}$/).transform(Number);
type Context = { params: Promise<{ number: string }> };

/**
 * One chapter of the selected character, body included, only while it is
 * unlocked for the caller. A chapter that is missing, retired or locked
 * answers the same 404, so a locked body never leaves the server.
 */
export async function GET(request: Request, { params }: Context) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    await requireAgeVerified(supabase, user.id);
    const number = numberSchema.parse((await params).number);
    await enforceRateLimit(user.id, STORY_RATE_LIMIT.bucket, STORY_RATE_LIMIT.limit, STORY_RATE_LIMIT.windowSeconds);
    const chapter = await readStoryChapter(supabase, user.id, number);
    if (!chapter) throw new ApiError(404, "Resource not found.", "not_found");
    return ok(chapter);
  });
}
