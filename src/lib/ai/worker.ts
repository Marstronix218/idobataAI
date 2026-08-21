import "server-only";

import type { AIJob, Json, SocialCompanion } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fallbackReply, resolveAIReply } from "@/lib/domain";
import { getAIProvider, type AIProvider } from "./provider";

type JobPayload = {
  replyId?: string;
  postId?: string;
  companionId?: string;
  engagementId?: string;
};

type PlannedSocialAction = {
  id: string;
  post_id: string;
  companion_id: string;
  target_reply_id: string | null;
  kind: "reply" | "reaction" | "repost";
  state: string;
  fallback_content: string | null;
};

type ActionPost = {
  id: string;
  author_id: string | null;
  content: string;
  content_status: string;
  task_title: string | null;
  category: string | null;
};

type ActionReply = {
  id: string;
  author_id: string | null;
  content: string;
  content_status: string;
};

function payload(job: AIJob) {
  return job.payload as JobPayload;
}

async function failJob(job: AIJob, lease: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown job error";
  await createAdminClient().rpc("fail_ai_job", {
    p_job_id: job.id,
    p_lease_token: lease,
    p_error: message,
    p_cooldown_seconds: Math.min(3600, 60 * 2 ** job.attempts),
  });
  return { id: job.id, status: "failed" };
}

async function enhanceLegacyReply(job: AIJob, lease: string, provider: AIProvider) {
  const admin = createAdminClient();
  const ids = payload(job);
  if (!ids.replyId || !ids.postId || !ids.companionId) throw new Error("Malformed job payload.");
  const [{ data: reply }, { data: post }, { data: companion }, { count: reports }] = await Promise.all([
    admin.from("social_replies").select("id, content, content_status").eq("id", ids.replyId).single(),
    admin.from("social_posts").select("id, content, content_status, task_title, category").eq("id", ids.postId).single(),
    admin.from("social_companions").select("id, name, personality, writing_style, safety_instructions, active").eq("id", ids.companionId).single(),
    admin.from("content_reports").select("id", { count: "exact", head: true }).eq("post_id", ids.postId),
  ]);
  if (!reply || !post || !companion || reply.content_status !== "active" || post.content_status !== "active" || !companion.active || reports) {
    throw new Error("Engagement target is unavailable, reported, or unsafe.");
  }
  const generated = await resolveAIReply({
    fallback: reply.content,
    generate: () => provider.generateReply({
      companionName: companion.name,
      personality: companion.personality,
      writingStyle: companion.writing_style,
      safetyInstructions: companion.safety_instructions,
      postContent: post.content,
      taskTitle: post.task_title,
      category: post.category,
    }),
  });
  if (generated.source !== "provider") {
    throw new Error(`Provider enhancement failed; fallback remains visible. ${generated.error ?? "No provider detail."}`);
  }
  const { data: finalized, error } = await admin.rpc("finalize_ai_reply_job", {
    p_job_id: job.id,
    p_lease_token: lease,
    p_content: generated.content,
  });
  if (error) throw error;
  if (!finalized) throw new Error("The AI job lease expired or its engagement target became unavailable.");
  return { id: job.id, status: "enhanced" };
}

async function performSocialAction(job: AIJob, lease: string, provider: AIProvider) {
  const admin = createAdminClient();
  const engagementId = payload(job).engagementId;
  if (!engagementId) throw new Error("Malformed social action payload.");

  const { data: action, error: actionError } = await admin.from("social_ai_engagements")
    .select("id, post_id, companion_id, target_reply_id, kind, state, fallback_content")
    .eq("id", engagementId)
    .single();
  if (actionError) throw actionError;
  const planned = action as PlannedSocialAction;

  if (planned.kind !== "reply") {
    const { data: finalized, error } = await admin.rpc("finalize_social_action", {
      p_job_id: job.id,
      p_lease_token: lease,
      p_content: null,
    });
    if (error) throw error;
    if (!finalized) throw new Error("The social action lease expired or its target became unavailable.");
    return { id: job.id, status: planned.kind === "repost" ? "reposted" : "reacted" };
  }

  const [postResult, companionResult, targetReplyResult] = await Promise.all([
    admin.from("social_posts")
      .select("id, author_id, content, content_status, task_title, category")
      .eq("id", planned.post_id)
      .single(),
    admin.from("social_companions")
      .select("id, name, personality, writing_style, safety_instructions, fallback_replies, active")
      .eq("id", planned.companion_id)
      .single(),
    planned.target_reply_id
      ? admin.from("social_replies")
        .select("id, author_id, content, content_status")
        .eq("id", planned.target_reply_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (postResult.error) throw postResult.error;
  if (companionResult.error) throw companionResult.error;
  if (targetReplyResult.error) throw targetReplyResult.error;
  const post = postResult.data as ActionPost;
  const companion = companionResult.data as Pick<SocialCompanion, "id" | "name" | "personality" | "writing_style" | "safety_instructions" | "fallback_replies" | "active">;
  const targetReply = targetReplyResult.data as ActionReply | null;
  if (!post || !companion?.active || post.content_status !== "active" || (targetReply && targetReply.content_status !== "active")) {
    throw new Error("Social action target is unavailable.");
  }

  const fallback = (planned.fallback_content?.trim()
    || companion.fallback_replies[0]?.trim()
    || fallbackReply(companion, { taskTitle: post.task_title, category: post.category })).slice(0, 500);
  const generated = await resolveAIReply({
    fallback,
    generate: () => provider.generateReply({
      companionName: companion.name,
      personality: companion.personality,
      writingStyle: companion.writing_style,
      safetyInstructions: companion.safety_instructions,
      postContent: (targetReply?.content ?? post.content).slice(0, 1200),
      taskTitle: post.task_title,
      category: post.category,
    }),
  });
  const { data: finalized, error } = await admin.rpc("finalize_social_action", {
    p_job_id: job.id,
    p_lease_token: lease,
    p_content: generated.content,
  });
  if (error) throw error;
  if (!finalized) throw new Error("The social action lease expired or its target became unavailable.");
  return { id: job.id, status: generated.source === "provider" ? "replied" : "fallback" };
}

export async function drainAIJobs(limit = 5) {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_ai_jobs", { p_limit: limit, p_lease_seconds: 120 });
  if (error) throw error;
  const provider = getAIProvider();
  const results = await Promise.all((jobs ?? []).map(async (job) => {
    const lease = job.lease_token;
    if (!lease) return { id: job.id, status: "skipped" };
    try {
      if (job.job_type === "enhance_reply") return await enhanceLegacyReply(job, lease, provider);
      if (job.job_type === "perform_social_action") return await performSocialAction(job, lease, provider);
      throw new Error(`Unsupported job type: ${job.job_type}`);
    } catch (error) {
      return failJob(job, lease, error);
    }
  }));
  return results as unknown as Json;
}
