import type { ThreadConversationContext } from "@/lib/domain/thread-conversation";

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
  // `thread_reply` is someone answering you inside a thread, which reads
  // differently from someone replying to your post.
  | "reply" | "thread_reply" | "reaction" | "repost" | "quote"
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

// Pivot A ("Character Coach"). Text columns constrained by CHECK in
// 20261031120100_pivot_a_core_schema.sql are typed as their allowed values.
export type CharacterRole = "coach" | "rival" | "cheerleader" | "deadpan";
export type CharacterEvent =
  | "task_started" | "task_finished" | "first_of_day" | "streak" | "comeback"
  | "session_nudge" | "split_intro" | "chapter_unlocked";
/** fresh < 1 day, days 1-6, weeks 7-29, stale >= 30. Null on a line matches any age. */
export type TaskAgeBucket = "fresh" | "days" | "weeks" | "stale";
export type TaskEventType = "started" | "finished";
export type ReactionSource = "prewritten" | "ai";
export type AIArm = "ai" | "prewritten";
/** `plus`, or `pack:<character slug>`. */
export type EntitlementProduct = "plus" | `pack:${string}`;
export type EntitlementStatus = "trialing" | "active" | "past_due" | "canceled" | "expired" | "refunded";
export type EntitlementSource = "stripe" | "app_store";
export type SafetyCounterKind = "crisis_card_shown" | "distress_check_unavailable";
/** What reserve_ai_usage / release_ai_usage count. */
export type AIUsageKind = "reaction" | "split";

export interface Character {
  id: string;
  slug: string;
  name: string;
  role: CharacterRole;
  art_url: string | null;
  is_launch: boolean;
  pack_sku: string | null;
  companion_id: string | null;
  /** Prompt material. Service role only: signed-in clients have no SELECT on this column, so never select `*`. */
  sheet: Json;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CharacterLine {
  id: string;
  character_id: string;
  event: CharacterEvent;
  text: string;
  min_streak: number | null;
  max_streak: number | null;
  task_age_bucket: TaskAgeBucket | null;
  tags: string[];
  active: boolean;
  updated_at: string;
}

export interface StoryChapter {
  id: string;
  character_id: string;
  number: number;
  title: string;
  body: string;
  unlock_rule: Json;
  active: boolean;
}

/** Pivot A profile fields, kept off the publicly readable user_profiles. */
export interface UserCoachProfile {
  user_id: string;
  selected_character_id: string | null;
  /** IANA zone; null means UTC. */
  timezone: string | null;
  age_verified_at: string | null;
  age_verification_method: string | null;
  ai_arm: AIArm | null;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: string;
  user_id: string;
  task_id: string;
  type: TaskEventType;
  occurred_at: string;
  /** The user's local date at `occurred_at`. */
  local_date: string;
  /** Finished events only: `single`, or the recurrence instance (date or ISO week). Unique per task. */
  occurrence_key: string | null;
}

export interface CharacterReaction {
  id: string;
  user_id: string;
  task_event_id: string | null;
  character_id: string;
  event: CharacterEvent;
  source: ReactionSource;
  line_id: string | null;
  text: string;
  disclosure_shown: boolean;
  created_at: string;
}

export interface AIUsageDaily {
  user_id: string;
  /** The user's local date. */
  date: string;
  reactions: number;
  splits: number;
  safety_checks: number;
  aborted_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  est_cost_usd: number;
  /** Reservations made by reserve_ai_usage; never released, so they bound model calls. */
  reaction_attempts: number;
  split_attempts: number;
  updated_at: string;
}

export interface StoryProgress {
  user_id: string;
  character_id: string;
  consistency_days: number;
  unlocked_through: number;
  last_consistency_date: string | null;
  updated_at: string;
}

/** One row per user and local date with a finished task; outlives deleted tasks (20261031160000). */
export interface CoachConsistencyDate {
  user_id: string;
  local_date: string;
}

export interface Entitlement {
  id: string;
  user_id: string;
  product: EntitlementProduct;
  status: EntitlementStatus;
  source: EntitlementSource;
  external_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

/** Aggregate only: no user id and no text. */
export interface SafetyCounter {
  date: string;
  kind: SafetyCounterKind;
  count: number;
}

/** Estimated AI spend per UTC day across all users, booked as it is metered (20261031210000). Service role read only. */
export interface AISpendDaily {
  date: string;
  est_cost_usd: number;
  updated_at: string;
}

/** Events record_coach_product_event writes; the other Pivot A events come from triggers. */
export type CoachProductEventName = "split_used" | "paywall_viewed" | "session_length";

/** One row of report_ai_arm(): plan_tier `all` is the arm as a whole. */
export interface AIArmReportRow {
  arm: AIArm;
  plan_tier: "all" | "free" | "trial" | "plus";
  users: number;
  tasks_finished: number;
  tasks_finished_per_user_week: number | null;
  day14_eligible_users: number;
  day14_retained_users: number;
  day14_retention: number | null;
}

/** The single row of report_ai_cost(). Per-user figures are null when their denominator is 0. */
export interface AICostReportRow {
  month: string;
  as_of: string;
  days_elapsed: number;
  days_in_month: number;
  total_cost_usd: number;
  active_users: number;
  paying_users: number;
  cost_per_active_user_usd: number | null;
  /** Users with activity in the 30 local days ending as_of. */
  active_users_30d: number;
  /** AI cost over those 30 days per user active in them: the free beta's alert basis. */
  cost_per_active_user_30d_usd: number | null;
  cost_per_paying_user_usd: number | null;
  projected_cost_per_paying_user_usd: number | null;
  users_at_reaction_cap: number;
  users_at_split_cap: number;
  share_at_reaction_cap: number | null;
  share_at_split_cap: number | null;
  /** The free beta's full access was on: the cap columns judge everyone against the Plus caps. */
  beta_full_access: boolean;
}

/** One call of purge_pivot_a_expired(): rows deleted per table; `more` when a batch came back full. */
export interface PivotARetentionPurge {
  character_reactions: number;
  age_verification_tokens: number;
  more: boolean;
}

/** Pivot A age gate: the hash of a single-use sign-up token. No user id and no date of birth. Service role and the auth hook only. */
export interface AgeVerificationToken {
  token_hash: string;
  method: string;
  verified_at: string;
  expires_at: string;
  consumed_at: string | null;
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
      characters: Table<Character, Partial<Character> & Pick<Character, "slug" | "name" | "role">>;
      character_lines: Table<CharacterLine, Partial<CharacterLine> & Pick<CharacterLine, "id" | "character_id" | "event" | "text">>;
      story_chapters: Table<StoryChapter, Partial<StoryChapter> & Pick<StoryChapter, "character_id" | "number" | "title" | "body">>;
      user_coach_profiles: Table<UserCoachProfile, Partial<UserCoachProfile> & Pick<UserCoachProfile, "user_id">>;
      task_events: Table<TaskEvent, Partial<TaskEvent> & Pick<TaskEvent, "user_id" | "task_id" | "type" | "local_date">>;
      character_reactions: Table<CharacterReaction, Partial<CharacterReaction> & Pick<CharacterReaction, "user_id" | "character_id" | "event" | "source" | "text">>;
      ai_usage_daily: Table<AIUsageDaily, Partial<AIUsageDaily> & Pick<AIUsageDaily, "user_id" | "date">>;
      story_progress: Table<StoryProgress, Partial<StoryProgress> & Pick<StoryProgress, "user_id" | "character_id">>;
      coach_consistency_dates: Table<CoachConsistencyDate, CoachConsistencyDate>;
      entitlements: Table<Entitlement, Partial<Entitlement> & Pick<Entitlement, "user_id" | "product" | "status" | "source">>;
      safety_counters: Table<SafetyCounter, Partial<SafetyCounter> & Pick<SafetyCounter, "date" | "kind">>;
      age_verification_tokens: Table<AgeVerificationToken, Partial<AgeVerificationToken> & Pick<AgeVerificationToken, "token_hash" | "method" | "expires_at">>;
      ai_spend_daily: Table<AISpendDaily>;
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
      get_reply_thread_context: {
        Args: { p_reply_id: string; p_limit?: number };
        Returns: ThreadConversationContext | null;
      };
      reply_thread_path: { Args: { p_reply_id: string }; Returns: Array<{ reply_id: string; depth: number }> };
      app_tuning_value: { Args: { p_key: string; p_default: number }; Returns: number };
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
      pivot_flag_enabled: { Args: { p_key: string }; Returns: boolean };
      coach_local_date: { Args: { p_user_id: string; p_at?: string }; Returns: string };
      coach_consistency_total_days: { Args: { p_user_id: string }; Returns: number };
      start_task: { Args: { p_task_id: string }; Returns: TaskEvent };
      set_coach_profile: { Args: { p_character_id?: string | null; p_timezone?: string | null }; Returns: UserCoachProfile };
      set_coach_age_verified: { Args: { p_user_id: string; p_method: string }; Returns: UserCoachProfile };
      record_ai_usage: {
        Args: {
          p_user_id: string;
          p_date: string;
          p_reactions: number;
          p_splits: number;
          p_safety_checks: number;
          p_aborted_calls: number;
          p_input_tokens: number;
          p_output_tokens: number;
          p_cache_read: number;
          p_cache_creation: number;
          p_cost: number;
        };
        Returns: undefined;
      };
      increment_safety_counter: { Args: { p_kind: SafetyCounterKind; p_date?: string }; Returns: undefined };
      reserve_ai_usage: {
        Args: { p_user_id: string; p_kind: AIUsageKind; p_date: string; p_window_days: number; p_cap: number; p_attempt_ceiling: number };
        Returns: boolean;
      };
      release_ai_usage: { Args: { p_user_id: string; p_kind: AIUsageKind; p_date: string }; Returns: undefined };
      record_coach_product_event: {
        Args: { p_user_id: string; p_event_name: CoachProductEventName; p_detail?: string | null; p_duration_seconds?: number | null };
        Returns: undefined;
      };
      coach_ai_arm: { Args: { p_user_id: string }; Returns: AIArm };
      report_ai_arm: { Args: { p_as_of?: string }; Returns: AIArmReportRow[] };
      report_ai_cost: {
        Args: {
          p_month?: string | null;
          p_as_of?: string | null;
          p_plus_daily_reactions?: number;
          p_plus_daily_splits?: number;
          p_free_weekly_reactions?: number;
        };
        Returns: AICostReportRow[];
      };
      purge_pivot_a_expired: { Args: { p_batch_size?: number }; Returns: PivotARetentionPurge };
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
