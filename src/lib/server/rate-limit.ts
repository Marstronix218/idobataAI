import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { ApiError } from "./http";

/**
 * Publishing, replies, reactions and chat sends were rate limited; task and
 * category creation, profile updates, thread creation and upload tickets were
 * not. The unguarded ones matter: thread creation lets one account place itself
 * in every other user's chat list without sending a message, and upload tickets
 * mint unbounded signed URLs for 5MB objects.
 *
 * `check_rate_limit` is an existing atomic definer function; this is just a
 * typed call site that turns a refusal into a 429.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient<Database>,
  bucket: string,
  limit: number,
  windowSeconds: number,
  message = "You are doing that a little too quickly. Try again shortly.",
) {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  // Fail closed: an unavailable limiter must not silently remove the limit.
  if (error) throw new ApiError(503, "Could not verify the request rate. Try again shortly.", "rate_limit_unavailable");
  if (data === false) throw new ApiError(429, message, "rate_limited");
}
