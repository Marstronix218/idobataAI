export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TaskVisibility = "private" | "public";
export type TaskStatus = "pending" | "completed";
export type PostVisibility = "private" | "public";
export type PostKind = "human_completion" | "human_progress" | "ai_daily_task" | "ai_progress" | "ai_completion";
export type ContentStatus = "active" | "hidden" | "removed";
export type ReactionKind = "like";
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

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

export interface Task {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  category: string | null;
  due_at: string | null;
  recurrence_rule: string | null;
  recurrence_instance_id: string | null;
  visibility: TaskVisibility;
  status: TaskStatus;
  xp_earned: number;
  completed_at: string | null;
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
  active: boolean;
  posting_frequency: number;
  created_at: string;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  author_id: string | null;
  companion_id: string | null;
  task_id: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface SocialReaction {
  id: string;
  post_id: string;
  actor_id: string | null;
  companion_id: string | null;
  reaction: ReactionKind;
  created_at: string;
}

export interface AIJob {
  id: string;
  job_type: "enhance_reply" | "schedule_companion_posts";
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

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  companion_id: string | null;
  post_id: string | null;
  reply_id: string | null;
  kind: "reply" | "reaction" | "system";
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
  content: string;
  content_status: ContentStatus;
  is_ai_generated: boolean;
  created_at: string;
  updated_at: string;
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
      public_task_progress: Table<Record<string, unknown>>;
      social_companions: Table<SocialCompanion>;
      social_posts: Table<SocialPost, Partial<SocialPost> & Pick<SocialPost, "content" | "kind">>;
      social_replies: Table<SocialReply, Partial<SocialReply> & Pick<SocialReply, "post_id" | "content">>;
      social_reactions: Table<SocialReaction, Partial<SocialReaction> & Pick<SocialReaction, "post_id" | "reaction">>;
      social_ai_engagements: Table<Record<string, unknown>>;
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
      check_rate_limit: { Args: { p_bucket: string; p_limit: number; p_window_seconds: number; p_actor_key?: string | null }; Returns: boolean };
      set_human_reaction: { Args: { p_post_id: string; p_reaction: ReactionKind }; Returns: SocialReaction };
      create_human_reply: { Args: { p_post_id: string; p_content: string; p_parent_reply_id?: string | null }; Returns: SocialReply };
      publish_progress_post: {
        Args: { p_content: string; p_visibility: PostVisibility; p_idempotency_key: string; p_task_id?: string | null; p_task_title?: string | null; p_category?: string | null };
        Returns: SocialPost;
      };
      report_content: { Args: { p_post_id?: string | null; p_reply_id?: string | null; p_reason: string }; Returns: string };
      set_user_block: { Args: { p_blocked_id: string; p_blocked: boolean }; Returns: boolean };
      set_companion_mute: { Args: { p_companion_id: string; p_muted: boolean }; Returns: boolean };
      mark_notifications_read: { Args: { p_ids?: string[] | null; p_all?: boolean }; Returns: number };
      get_or_create_chat_thread: { Args: { p_user_id?: string | null; p_companion_id?: string | null }; Returns: ChatThread };
      create_chat_message: { Args: { p_thread_id: string; p_content: string }; Returns: ChatMessage };
      create_companion_chat_message: { Args: { p_thread_id: string; p_companion_id: string; p_content: string }; Returns: ChatMessage };
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
    };
    CompositeTypes: Record<string, never>;
  };
}

export type FeedPost = SocialPost & {
  image_urls: string[];
  user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
  social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  social_reactions: Array<Pick<SocialReaction, "id" | "reaction" | "actor_id" | "companion_id">>;
  social_replies: Array<SocialReply & {
    user_profiles: (Pick<UserProfile, "username" | "avatar_url"> & Partial<Pick<UserProfile, "display_name">>) | null;
    social_companions: Pick<SocialCompanion, "name" | "slug" | "avatar_url"> | null;
  }>;
};
