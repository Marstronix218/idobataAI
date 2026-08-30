export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TaskVisibility = "private" | "public";
export type TaskStatus = "pending" | "completed";
export type TaskPriority = 1 | 2 | 3 | 4;
export type PostVisibility = "private" | "public";
export type PostKind = "human_completion" | "human_progress" | "human_quote" | "ai_daily_task" | "ai_progress" | "ai_completion" | "ai_quote";
export type ContentStatus = "active" | "hidden" | "removed";
export type ReactionKind = "like";
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type CompanionFollowState = "none" | "pending" | "following";
export type HumanFollowState = "none" | "requested" | "following";
export type EngagementKind = "reply" | "reaction" | "repost" | "quote";
export type EngagementSource = "human_post_guarantee" | "human_post_engagement" | "human_reply_response" | "daily_quota" | "ambient";
export type EngagementState = "planned" | "processing" | "completed" | "failed" | "cancelled";
export type FeedbackType = "idea" | "issue" | "other";
/** How readily a persona engages with other people's completed-task posts. */
export type SocialActivity = "high" | "medium" | "selective";
/** Task category to interest weight (0-1); `other` is the unlisted baseline. */
export type CategoryAffinity = Record<string, number>;

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  profile_visibility: PostVisibility;
  daily_goal: number;
  interests: string[];
  default_task_visibility: TaskVisibility;
  completion_visibility: PostVisibility;
  xp: number;
  current_streak: number;
  last_completion_date: string | null;
  created_at: string;
  updated_at: string;
}

/** One person in the follow directory, from `search_user_directory`. */
export interface DirectoryUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  viewer_follows: boolean;
}

/** One pending inbound follow request, from `get_follow_requests`. */
export interface FollowRequest {
  requester_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

/** The identity card any signed-in reader may see, from `get_profile_card`. */
export interface ProfileCard {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  interests: string[];
  current_streak: number;
  profile_visibility: PostVisibility;
  created_at: string;
}

/** One AI persona in the follow directory, from `search_companion_directory`. */
export interface DirectoryPersona {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  viewer_follows: boolean;
}

/**
 * One person in a profile's follower or following list, from
 * `list_profile_followers` / `list_profile_following`. `viewer_follows` and
 * `viewer_requested` describe the *reader's* relationship with the row, not the
 * profile owner's, so each row can render its own Follow / Requested control.
 */
export interface ProfileFollowPerson {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  profile_visibility: PostVisibility;
  followed_at: string;
  viewer_follows: boolean;
  viewer_requested: boolean;
  is_viewer: boolean;
}

/**
 * One AI persona in a profile's AI follower or AI following list, from
 * `list_profile_ai_followers` / `list_profile_ai_following` /
 * `list_profile_favorite_personas`. `viewer_follows` is the *reader's* own
 * relationship with the persona, while `is_favorite` is the profile owner's --
 * one drives the row's Follow button, the other its star.
 */
export interface ProfileFollowPersona {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  followed_at: string | null;
  viewer_follows: boolean;
  is_favorite: boolean;
}

export interface Task {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  category: string | null;
  due_at: string | null;
  due_has_time: boolean;
  due_timezone: string | null;
  recurrence_rule: string | null;
  recurrence_instance_id: string | null;
  priority: TaskPriority | null;
  visibility: TaskVisibility;
  status: TaskStatus;
  xp_earned: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCategory {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SocialCompanion {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  writing_style: string;
  interests: string[];
  safety_instructions: string;
  fallback_replies: string[];
  daily_templates: string[];
  daily_posts: Array<{
    task_title: string;
    category: string;
    content: string;
  }>;
  active: boolean;
  posting_frequency: number;
  /** How readily this persona engages with other people's completed tasks. */
  social_activity: SocialActivity;
  like_affinity: number;
  reply_affinity: number;
  quote_affinity: number;
  /** Task category to interest weight; `other` is the baseline for the rest. */
  category_affinity: CategoryAffinity;
  reply_style: string;
  quote_style: string;
  tone_rules: string[];
  avoid_rules: string[];
  created_at: string;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  author_id: string | null;
  companion_id: string | null;
  task_id: string | null;
  quoted_post_id: string | null;
  kind: PostKind;
  visibility: PostVisibility;
  content_status: ContentStatus;
  content: string;
  task_title: string | null;
  category: string | null;
  xp_earned: number | null;
  streak: number | null;
  completed_at: string | null;
  idempotency_key: string | null;
  source_key: string | null;
  image_paths: string[];
  is_ai_generated: boolean;
  // Maintained by trigger so the list feed can show a reply count without
  // joining reply bodies. Only the trigger may write it.
  reply_count: number;
  created_at: string;
  updated_at: string;
}

export interface SocialReply {
  id: string;
  post_id: string;
  parent_reply_id: string | null;
  author_id: string | null;
  companion_id: string | null;
  content: string;
  content_status: ContentStatus;
  is_ai_generated: boolean;
  // Both counters are maintained by triggers so a thread can render its like and
  // sub-reply totals without joining reactions or child rows per reply. Only the
  // triggers may write them.
  like_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
}

export interface SocialReaction {
  id: string;
  post_id: string;
  // Null targets the post itself; set targets one reply on that post.
  reply_id: string | null;
  actor_id: string | null;
  companion_id: string | null;
  reaction: ReactionKind;
  created_at: string;
}

export interface UserCompanionRelationship {
  user_id: string;
  companion_id: string;
  user_followed_at: string | null;
  companion_follow_state: CompanionFollowState;
  companion_follow_requested_at: string | null;
  companion_followed_at: string | null;
  dm_opt_in: boolean;
  is_favorite: boolean;
  favorited_at: string | null;
  companion_dm_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFollow {
  follower_id: string;
  followed_id: string;
  created_at: string;
}

export interface SocialRepost {
  id: string;
  post_id: string;
  actor_id: string | null;
  companion_id: string | null;
  created_at: string;
}

export type FeedRepost = Pick<SocialRepost, "id" | "companion_id" | "created_at"> & {
  user_id: string | null;
  social_companions?: Pick<SocialCompanion, "name" | "slug"> | null;
};

export interface CompanionUserMemory {
  user_id: string;
  companion_id: string;
  summary: string;
  facts: Json;
  source_watermark: string | null;
  expires_at: string | null;
  reset_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SocialAIEngagement {
  id: string;
  post_id: string;
  companion_id: string;
  slot: number | null;
  kind: EngagementKind;
  reply_id: string | null;
  reaction_id: string | null;
  repost_id: string | null;
  quote_post_id: string | null;
  /** Internal selection metadata. Never rendered to users. */
  decision: Json | null;
  fallback_content: string | null;
  enhanced: boolean;
  dedupe_key: string;
  source: EngagementSource;
  state: EngagementState;
  scheduled_for: string;
  target_reply_id: string | null;
  failure_reason: string | null;
  created_at: string;
}

/**
 * Everything `get_post_engagement_context` returns for one completed-task post:
 * the post, the feature flags, the persona replies already on it, and every
 * eligible persona with the counters that suppress repetitive attention.
 */
export interface PostEngagementContext {
  post: {
    id: string;
    authorId: string | null;
    kind: PostKind;
    visibility: PostVisibility;
    contentStatus: ContentStatus;
    content: string;
    taskTitle: string | null;
    category: string | null;
    streak: number | null;
    xpEarned: number | null;
    focusMinutes: number | null;
    createdAt: string;
  };
  flags: { likes: boolean; replies: boolean; quotes: boolean };
  siblingReplies: string[];
  companions: Array<{
    id: string;
    slug: string;
    active: boolean;
    socialActivity: SocialActivity;
    likeAffinity: number;
    replyAffinity: number;
    quoteAffinity: number;
    categoryAffinity: CategoryAffinity;
    isFavorite: boolean;
    engagedThisPost: boolean;
    repliesToAuthorRecently: number;
    quotesRecently: number;
  }>;
}

export interface AIJob {
  id: string;
  job_type: "enhance_reply" | "schedule_companion_posts" | "perform_social_action" | "plan_post_engagement";
  dedupe_key: string;
  payload: Json;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NotificationKind =
  | "reply" | "reaction" | "repost" | "quote"
  | "follow" | "follow_request" | "follow_accepted" | "system";

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  companion_id: string | null;
  post_id: string | null;
  reply_id: string | null;
  kind: NotificationKind;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  replies: boolean;
  reactions: boolean;
  companion_activity: boolean;
  email_digest: boolean;
  updated_at: string;
}

export interface ChatThread {
  id: string;
  user_one_id: string;
  user_two_id: string | null;
  companion_id: string | null;
  created_by: string;
  last_message_preview: string | null;
  last_sender_user_id: string | null;
  last_sender_companion_id: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_user_id: string | null;
  sender_companion_id: string | null;
  client_request_id: string | null;
  reply_to_message_id: string | null;
  content: string;
  content_status: ContentStatus;
  is_ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeedbackSubmission {
  id: string;
  user_id: string;
  category: FeedbackType;
  message: string;
  created_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row & Record<string, unknown>;
  Insert: Insert & Record<string, unknown>;
  Update: Update & Record<string, unknown>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      user_profiles: Table<UserProfile, Partial<UserProfile> & Pick<UserProfile, "id" | "username">>;
      tasks: Table<Task, Partial<Task> & Pick<Task, "owner_id" | "title">>;
      task_categories: Table<TaskCategory, Partial<TaskCategory> & Pick<TaskCategory, "owner_id" | "name">>;
      public_task_progress: Table<Record<string, unknown>>;
      social_companions: Table<SocialCompanion>;
      social_posts: Table<SocialPost, Partial<SocialPost> & Pick<SocialPost, "content" | "kind">>;
      social_replies: Table<SocialReply, Partial<SocialReply> & Pick<SocialReply, "post_id" | "content">>;
      social_reactions: Table<SocialReaction, Partial<SocialReaction> & Pick<SocialReaction, "post_id" | "reaction">>;
      user_follows: Table<UserFollow, Pick<UserFollow, "follower_id" | "followed_id">>;
      user_companion_relationships: Table<UserCompanionRelationship, Partial<UserCompanionRelationship> & Pick<UserCompanionRelationship, "user_id" | "companion_id">>;
      social_reposts: Table<SocialRepost, Partial<SocialRepost> & Pick<SocialRepost, "post_id">>;
      companion_user_memory: Table<CompanionUserMemory, Partial<CompanionUserMemory> & Pick<CompanionUserMemory, "user_id" | "companion_id">>;
      social_ai_engagements: Table<SocialAIEngagement>;
      ai_jobs: Table<AIJob>;
      notification_preferences: Table<NotificationPreferences>;
      notifications: Table<Notification>;
      account_deletion_requests: Table<Record<string, unknown>>;
      task_completion_awards: Table<Record<string, unknown>>;
      blocked_users: Table<Record<string, unknown>>;
      muted_companions: Table<Record<string, unknown>>;
      content_reports: Table<Record<string, unknown>>;
      api_rate_limits: Table<Record<string, unknown>>;
      chat_threads: Table<ChatThread, Partial<ChatThread> & Pick<ChatThread, "user_one_id" | "created_by">>;
      chat_messages: Table<ChatMessage, Partial<ChatMessage> & Pick<ChatMessage, "thread_id" | "content">>;
      feedback_submissions: Table<FeedbackSubmission, Partial<FeedbackSubmission> & Pick<FeedbackSubmission, "user_id" | "category" | "message">>;
    };
    Views: Record<string, never>;
    Functions: {
      publish_task_completion: {
        Args: { p_task_id: string; p_message?: string | null; p_visibility?: PostVisibility; p_recurrence_instance_id?: string | null };
        Returns: SocialPost;
      };
      claim_ai_jobs: { Args: { p_limit?: number; p_lease_seconds?: number }; Returns: AIJob[] };
      complete_ai_job: { Args: { p_job_id: string; p_lease_token: string }; Returns: boolean };
      finalize_ai_reply_job: { Args: { p_job_id: string; p_lease_token: string; p_content: string }; Returns: boolean };
      fail_ai_job: { Args: { p_job_id: string; p_lease_token: string; p_error: string; p_cooldown_seconds?: number }; Returns: boolean };
      schedule_companion_posts: { Args: { p_date?: string }; Returns: number };
      rollover_recurring_tasks: { Args: { p_date?: string }; Returns: number };
      search_chat_contacts: {
        Args: { p_query?: string; p_limit?: number };
        Returns: Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null; bio: string | null }>;
      };
      check_rate_limit: { Args: { p_bucket: string; p_limit: number; p_window_seconds: number; p_actor_key?: string | null }; Returns: boolean };
      set_human_reaction: { Args: { p_post_id: string; p_reaction: ReactionKind }; Returns: SocialReaction };
      set_human_reply_reaction: { Args: { p_reply_id: string; p_reaction: ReactionKind }; Returns: SocialReaction };
      set_human_repost: { Args: { p_post_id: string; p_reposted: boolean }; Returns: SocialRepost };
      publish_quote_repost: {
        Args: { p_post_id: string; p_content: string; p_visibility: PostVisibility; p_idempotency_key: string };
        Returns: SocialPost;
      };
      set_user_follow: { Args: { p_followed_id: string; p_following: boolean }; Returns: HumanFollowState };
      respond_follow_request: { Args: { p_requester_id: string; p_accept: boolean }; Returns: HumanFollowState };
      get_follow_requests: { Args: { p_limit?: number }; Returns: FollowRequest[] };
      get_profile_card: { Args: { p_username: string }; Returns: ProfileCard[] };
      get_profile_follow_summary: {
        Args: { p_user_id: string };
        Returns: Array<{
          follower_count: number;
          following_count: number;
          viewer_follows: boolean;
          viewer_requested: boolean;
          pending_request_count: number;
        }>;
      };
      search_companion_directory: {
        Args: { p_query?: string; p_limit?: number };
        Returns: Array<{
          id: string;
          slug: string;
          name: string;
          avatar_url: string | null;
          personality: string;
          viewer_follows: boolean;
        }>;
      };
      search_user_directory: {
        Args: { p_query?: string; p_limit?: number };
        Returns: Array<{
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          follower_count: number;
          viewer_follows: boolean;
        }>;
      };
      get_following_post_ids: {
        Args: { p_category?: string | null; p_before?: string | null; p_before_id?: string | null; p_limit?: number };
        Returns: Array<{ post_id: string; created_at: string }>;
      };
      set_user_companion_follow: { Args: { p_companion_id: string; p_following: boolean }; Returns: UserCompanionRelationship };
      set_user_companion_favorite: { Args: { p_companion_id: string; p_favorite: boolean }; Returns: UserCompanionRelationship };
      request_companion_follow: { Args: { p_user_id: string; p_companion_id: string }; Returns: UserCompanionRelationship };
      get_profile_ai_follower_count: { Args: { p_user_id: string }; Returns: number };
      get_profile_ai_following_count: { Args: { p_user_id: string }; Returns: number };
      list_profile_followers: {
        Args: { p_user_id: string; p_limit?: number; p_offset?: number };
        Returns: ProfileFollowPerson[];
      };
      list_profile_following: {
        Args: { p_user_id: string; p_limit?: number; p_offset?: number };
        Returns: ProfileFollowPerson[];
      };
      list_profile_ai_followers: {
        Args: { p_user_id: string; p_limit?: number; p_offset?: number };
        Returns: ProfileFollowPersona[];
      };
      list_profile_ai_following: {
        Args: { p_user_id: string; p_limit?: number; p_offset?: number };
        Returns: ProfileFollowPersona[];
      };
      list_profile_favorite_personas: {
        Args: { p_user_id: string };
        Returns: ProfileFollowPersona[];
      };
      respond_companion_follow: { Args: { p_companion_id: string; p_accept: boolean }; Returns: UserCompanionRelationship };
      set_companion_dm_opt_in: { Args: { p_companion_id: string; p_opt_in: boolean }; Returns: UserCompanionRelationship };
      start_companion_dm: { Args: { p_user_id: string; p_companion_id: string; p_content: string }; Returns: ChatMessage | null };
      reset_companion_memory: { Args: { p_companion_id: string }; Returns: boolean };
      refresh_companion_memory: {
        Args: {
          p_user_id: string;
          p_companion_id: string;
          p_summary: string;
          p_facts: Json;
          p_source_watermark: string | null;
          p_expires_at: string;
          p_expected_version: number;
          p_memory_boundary: string | null;
        };
        Returns: boolean;
      };
      enqueue_social_action: {
        Args: { p_dedupe_key: string; p_source: EngagementSource; p_kind: EngagementKind; p_post_id: string; p_companion_id: string; p_target_reply_id?: string | null; p_scheduled_for?: string; p_decision?: Json | null };
        Returns: string;
      };
      get_post_engagement_context: { Args: { p_post_id: string }; Returns: PostEngagementContext | null };
      cancel_social_action: { Args: { p_job_id: string; p_lease_token: string; p_reason: string }; Returns: boolean };
      reconcile_persona_engagements: { Args: { p_date?: string }; Returns: number };
      finalize_social_action: { Args: { p_job_id: string; p_lease_token: string; p_content?: string | null }; Returns: boolean };
      create_human_reply: { Args: { p_post_id: string; p_content: string; p_parent_reply_id?: string | null }; Returns: SocialReply };
      publish_progress_post: {
        Args: { p_content: string; p_visibility: PostVisibility; p_idempotency_key: string; p_task_id?: string | null; p_task_title?: string | null; p_category?: string | null };
        Returns: SocialPost;
      };
      rename_task_category: { Args: { p_category_id: string; p_name: string }; Returns: TaskCategory };
      delete_task_category: { Args: { p_category_id: string }; Returns: boolean };
      report_content: { Args: { p_post_id?: string | null; p_reply_id?: string | null; p_reason: string }; Returns: string };
      set_user_block: { Args: { p_blocked_id: string; p_blocked: boolean }; Returns: boolean };
      set_companion_mute: { Args: { p_companion_id: string; p_muted: boolean }; Returns: boolean };
      mark_notifications_read: { Args: { p_ids?: string[] | null; p_all?: boolean }; Returns: number };
      get_or_create_chat_thread: { Args: { p_user_id?: string | null; p_companion_id?: string | null }; Returns: ChatThread };
      create_chat_message: { Args: { p_thread_id: string; p_content: string }; Returns: ChatMessage };
      create_companion_chat_message: { Args: { p_thread_id: string; p_companion_id: string; p_content: string }; Returns: ChatMessage };
      create_beta_chat_message: {
        Args: { p_user_id: string; p_thread_id: string; p_content: string; p_client_request_id: string; p_daily_limit: number };
        Returns: ChatMessage;
      };
      create_companion_chat_reply: {
        Args: { p_thread_id: string; p_companion_id: string; p_user_message_id: string; p_content: string };
        Returns: ChatMessage;
      };
      submit_feedback: { Args: { p_category: FeedbackType; p_message: string }; Returns: string };
    };
    Enums: {
      task_visibility: TaskVisibility;
      task_status: TaskStatus;
      post_visibility: PostVisibility;
      post_kind: PostKind;
      content_status: ContentStatus;
      reaction_kind: ReactionKind;
      engagement_kind: "reply" | "reaction";
      job_status: JobStatus;
      feedback_type: FeedbackType;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type FeedPost = SocialPost & {
  image_urls: string[];
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  social_reactions: Array<Pick<SocialReaction, "id" | "reaction" | "actor_id" | "companion_id" | "reply_id">>;
  social_reposts?: FeedRepost[];
  social_replies: ThreadReply[];
  quoted_post: QuotedFeedPost | null;
};

export type QuotedFeedPost = SocialPost & {
  image_urls: string[];
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
};

// One notification row as the activity list receives it. A quote notification's
// `social_posts` is the quoting post, carrying the original in `quoted_post`, so
// the row can render the same shape a feed does.
export type ActivityPost = Pick<SocialPost,
  "id" | "content" | "task_title" | "category" | "kind" | "content_status" | "image_paths" | "created_at" | "author_id" | "companion_id" | "visibility" | "reply_count"
> & {
  image_urls?: string[];
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  // Present so a quote notification can carry the same like/reply/repost
  // controls the post shows in a feed. Narrowed to the post's own likes.
  social_reactions?: Array<Pick<SocialReaction, "id" | "reaction" | "actor_id" | "companion_id" | "reply_id">>;
  social_reposts?: FeedRepost[];
  quoted_post?: (Omit<ActivityPost, "quoted_post"> | null);
};

export type ActivityItem = Notification & {
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  social_posts: ActivityPost | null;
};

export type ThreadReply = SocialReply & {
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  // Whether the requesting viewer has liked this reply. Resolved server-side in
  // one query per thread rather than by expanding reactions on every reply.
  viewer_liked: boolean;
};
