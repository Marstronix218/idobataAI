import type { FeedPost, QuotedFeedPost } from "@/types";

export function toQuotedFeedPost(post: FeedPost): QuotedFeedPost {
  return {
    id: post.id,
    author_id: post.author_id,
    companion_id: post.companion_id,
    task_id: post.task_id,
    quoted_post_id: post.quoted_post_id,
    kind: post.kind,
    visibility: post.visibility,
    content_status: post.content_status,
    content: post.content,
    task_title: post.task_title,
    category: post.category,
    xp_earned: post.xp_earned,
    streak: post.streak,
    completed_at: post.completed_at,
    idempotency_key: post.idempotency_key,
    source_key: post.source_key,
    image_paths: post.image_paths,
    image_urls: post.image_urls,
    is_ai_generated: post.is_ai_generated,
    reply_count: post.reply_count,
    created_at: post.created_at,
    updated_at: post.updated_at,
    user_profiles: post.user_profiles,
    social_companions: post.social_companions,
  };
}
