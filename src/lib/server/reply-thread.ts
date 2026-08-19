import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDatabase } from "@/lib/server/http";
import type { Database, ThreadReply } from "@/types";

export const THREAD_REPLY_LIMIT = 200;

const replySelect = "*, user_profiles(username, display_name, avatar_url), social_companions(name, slug, avatar_url)";

/**
 * Loads a post's whole conversation, flat, with the viewer's own like state
 * resolved.
 *
 * `viewer_liked` deliberately comes from one extra scalar query over the
 * viewer's own reactions rather than from expanding
 * `social_reactions(...)` on every reply: a thread is bounded at
 * THREAD_REPLY_LIMIT rows, but the reactions hanging off it are not, so the
 * nested form would let one busy thread pull an unbounded payload. Like and
 * reply totals are already denormalized onto the reply rows by trigger.
 *
 * The client assembles the parent/child tree from `parent_reply_id`; sending it
 * flat keeps the response shape stable no matter how deep the thread nests.
 */
export async function loadThreadReplies(
  supabase: SupabaseClient<Database>,
  postId: string,
  viewerId: string,
): Promise<ThreadReply[]> {
  const replies = assertDatabase(
    await supabase.from("social_replies")
      .select(replySelect)
      .eq("post_id", postId)
      .eq("content_status", "active")
      // `id` breaks ties: replies written in one transaction share a
      // `created_at`, and without a tiebreaker their order -- and so the shape
      // of the thread -- can change between requests. Matches the
      // (post_id, created_at, id) index.
      .order("created_at").order("id")
      .limit(THREAD_REPLY_LIMIT),
  ) as unknown as Array<Omit<ThreadReply, "viewer_liked">>;

  if (!replies.length) return [];

  const likes = assertDatabase(
    await supabase.from("social_reactions")
      .select("reply_id")
      .eq("post_id", postId)
      .eq("actor_id", viewerId)
      .not("reply_id", "is", null),
  ) as unknown as Array<{ reply_id: string }>;
  const likedReplyIds = new Set(likes.map((like) => like.reply_id));

  return replies.map((reply) => ({ ...reply, viewer_liked: likedReplyIds.has(reply.id) }));
}
