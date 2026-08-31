import "server-only";

import { after } from "next/server";
import type { AIJob, Json, PostEngagementContext, SocialCompanion } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canPlanPersonaEngagement,
  fallbackReply,
  personaEngagementChannels,
} from "@/lib/domain";
import { checkReplyDiversity, sanitizePersonaReply } from "@/lib/domain/reply-diversity";
import {
  buildThreadConversation,
  resolveThreadConversationLimits,
  threadPostSummary,
  type ThreadConversationContext,
} from "@/lib/domain/thread-conversation";
import { planPersonaEngagement, type EngagementAction, type EngagementLimits } from "@/lib/domain/persona-engagement";
import { classifyTask } from "@/lib/domain/task-affinity";
import { getAIProvider, PERSONA_ENGAGEMENT_PROMPT_VERSION, type AIProvider } from "./provider";

type JobPayload = {
  replyId?: string;
  postId?: string;
  companionId?: string;
  engagementId?: string;
  excludeCompanionId?: string;
};

type PlannedSocialAction = {
  id: string;
  post_id: string;
  companion_id: string;
  target_reply_id: string | null;
  kind: "reply" | "reaction" | "repost" | "quote";
  state: string;
  source: string;
  fallback_content: string | null;
};

type ActionPost = {
  id: string;
  author_id: string | null;
  content: string;
  content_status: string;
  task_title: string | null;
  category: string | null;
  streak: number | null;
  xp_earned: number | null;
};

type ActionReply = {
  id: string;
  author_id: string | null;
  content: string;
  content_status: string;
};

/** The persona fields the engagement prompts read, beyond the base identity. */
type EngagementCompanion = Pick<
  SocialCompanion,
  "id" | "name" | "personality" | "writing_style" | "safety_instructions" | "fallback_replies" | "active"
  | "reply_style" | "quote_style" | "tone_rules" | "avoid_rules"
>;

const ENGAGEMENT_COMPANION_COLUMNS =
  "id, name, personality, writing_style, safety_instructions, fallback_replies, active, reply_style, quote_style, tone_rules, avoid_rules";

/** Kept in one place so the planner's vocabulary maps onto the ledger's. */
const ACTION_KIND: Record<EngagementAction, "reply" | "reaction" | "quote"> = {
  reply: "reply",
  like: "reaction",
  quote: "quote",
};

function engagementLimit(name: string, fallback: number, maximum: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : fallback;
}

function configuredEngagementLimits(): EngagementLimits {
  return {
    maxLikes: engagementLimit("AI_ENGAGEMENT_MAX_LIKES", 5, 5),
    maxReplies: engagementLimit("AI_ENGAGEMENT_MAX_REPLIES", 2, 2),
    maxQuotes: engagementLimit("AI_ENGAGEMENT_MAX_QUOTES", 1, 1),
    candidatePool: engagementLimit("AI_ENGAGEMENT_CANDIDATE_POOL", 8, 50),
  };
}

function payload(job: AIJob) {
  return job.payload as JobPayload;
}

/**
 * Generation is invisible once it lands in a feed, so the reasoning behind each
 * action is logged rather than shown. Nothing here reaches a user.
 */
function logEngagement(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", scope: "persona_engagement", ...fields }));
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
    admin.from("social_posts").select("id, author_id, content, content_status, task_title, category, streak, xp_earned").eq("id", ids.postId).single(),
    admin.from("social_companions").select(ENGAGEMENT_COMPANION_COLUMNS).eq("id", ids.companionId).single(),
    admin.from("content_reports").select("id", { count: "exact", head: true }).eq("post_id", ids.postId),
  ]);
  if (!reply || !post || !companion || reply.content_status !== "active" || post.content_status !== "active" || !companion.active || reports) {
    throw new Error("Engagement target is unavailable, reported, or unsafe.");
  }
  const typedPost = post as ActionPost;
  const typedCompanion = companion as EngagementCompanion;
  const context = await loadGenerationContext(ids.postId, ids.companionId);
  const taskCategory = classifyTask({ taskTitle: typedPost.task_title, category: typedPost.category, content: typedPost.content });
  const generated = await generateDistinctText({
    siblingReplies: context.siblingReplies,
    personaRecentReplies: context.recentReplies,
    sourceTexts: [typedPost.task_title, typedPost.content],
    generate: (avoid) => provider.generateReply({
      companionName: companion.name,
      personality: companion.personality,
      writingStyle: companion.writing_style,
      safetyInstructions: companion.safety_instructions,
      replyStyle: typedCompanion.reply_style,
      toneRules: typedCompanion.tone_rules,
      avoidRules: typedCompanion.avoid_rules,
      postContent: typedPost.content,
      taskTitle: typedPost.task_title,
      category: typedPost.category,
      taskCategory,
      streak: typedPost.streak,
      xpEarned: typedPost.xp_earned,
      siblingReplies: context.siblingReplies,
      recentReplies: avoid,
    }),
  });
  if (!generated.content) {
    throw new Error(`Provider enhancement failed quality checks; fallback remains visible. ${generated.rejectionReason ?? "No provider detail."}`);
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

/**
 * The context every reply and quote is written against: what other personas
 * have already said here, and what this persona has said lately. Without both,
 * two characters converge on the same sentence and one character develops a
 * catchphrase, which is what makes generated engagement read as a single bot.
 */
async function loadGenerationContext(postId: string, companionId: string) {
  const admin = createAdminClient();
  const [siblings, recentReplies, recentQuotes] = await Promise.all([
    admin.from("social_replies")
      .select("content, companion_id, created_at")
      .eq("post_id", postId)
      .eq("content_status", "active")
      .not("companion_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(6),
    admin.from("social_replies")
      .select("content, created_at")
      .eq("companion_id", companionId)
      .eq("content_status", "active")
      .order("created_at", { ascending: false })
      .limit(6),
    admin.from("social_posts")
      .select("content, created_at")
      .eq("companion_id", companionId)
      .eq("kind", "ai_quote")
      .eq("content_status", "active")
      .order("created_at", { ascending: false })
      .limit(4),
  ]);
  return {
    siblingReplies: (siblings.data ?? [])
      .filter((row) => row.companion_id !== companionId)
      .map((row) => row.content),
    recentReplies: (recentReplies.data ?? []).map((row) => row.content),
    recentQuotes: (recentQuotes.data ?? []).map((row) => row.content),
  };
}

/**
 * The conversation one persona is having in a single branch of a thread.
 *
 * Returns null when this character has never spoken in that branch, which is
 * how a first reaction to a task stays a reaction: only a persona answering its
 * own conversation partner gets the conversational prompt.
 */
async function loadThreadConversation(targetReplyId: string, companionId: string) {
  const limits = resolveThreadConversationLimits();
  const { data, error } = await createAdminClient().rpc("get_reply_thread_context", {
    p_reply_id: targetReplyId,
    // One extra turn beyond the window so the trim is a real choice rather than
    // whatever the database happened to return.
    p_limit: limits.contextMessages + 2,
  });
  if (error) throw error;
  const context = data as ThreadConversationContext | null;
  if (!context?.messages?.length) return null;

  const conversation = buildThreadConversation(context, companionId, limits);
  if (!conversation.conversational || !conversation.turns.length) return null;
  return {
    turns: conversation.turns,
    post: threadPostSummary(context, limits),
    depth: context.depth,
    personaTurns: conversation.personaTurns,
  };
}

/**
 * Generates, screens, and regenerates once. A near-duplicate of a sibling reply
 * is worse than silence: it is visible proof that the characters are one voice.
 */
async function generateDistinctText({
  generate,
  siblingReplies,
  personaRecentReplies,
  sourceTexts,
  maxCharacters = 280,
}: {
  generate: (avoid: string[]) => Promise<string>;
  siblingReplies: string[];
  personaRecentReplies: string[];
  sourceTexts: Array<string | null | undefined>;
  maxCharacters?: number;
}) {
  // The rejected draft is fed back as something to avoid, so the retry is a
  // genuine second attempt rather than the same prompt rolled again.
  const avoid = [...personaRecentReplies];
  let rejectionReason: string | undefined;
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try {
      const content = sanitizePersonaReply(await generate(avoid));
      const verdict = checkReplyDiversity({ content, siblingReplies, personaRecentReplies, sourceTexts, maxCharacters });
      if (verdict.ok) return { content: content as string | null, attempts, rejectionReason: undefined as string | undefined };
      rejectionReason = verdict.reason;
      avoid.push(content);
    } catch (error) {
      rejectionReason = error instanceof Error ? error.message : "provider_error";
    }
  }
  return { content: null as string | null, attempts: 2, rejectionReason };
}

function usableFallback(
  candidates: Array<string | null | undefined>,
  sourceTexts: Array<string | null | undefined>,
) {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const content = sanitizePersonaReply(candidate);
    if (checkReplyDiversity({ content, sourceTexts }).ok) return content;
  }
  return "Noted. That one counts.";
}

async function performSocialAction(job: AIJob, lease: string, provider: AIProvider) {
  const admin = createAdminClient();
  const engagementId = payload(job).engagementId;
  if (!engagementId) throw new Error("Malformed social action payload.");

  const { data: action, error: actionError } = await admin.from("social_ai_engagements")
    .select("id, post_id, companion_id, target_reply_id, kind, state, source, fallback_content")
    .eq("id", engagementId)
    .single();
  if (actionError) throw actionError;
  const planned = action as PlannedSocialAction;

  if (planned.kind === "reaction" || planned.kind === "repost") {
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
      .select("id, author_id, content, content_status, task_title, category, streak, xp_earned")
      .eq("id", planned.post_id)
      .single(),
    admin.from("social_companions").select(ENGAGEMENT_COMPANION_COLUMNS).eq("id", planned.companion_id).single(),
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
  const companion = companionResult.data as EngagementCompanion;
  const targetReply = targetReplyResult.data as ActionReply | null;
  if (!post || !companion?.active || post.content_status !== "active" || (targetReply && targetReply.content_status !== "active")) {
    throw new Error("Social action target is unavailable.");
  }

  const taskCategory = classifyTask({ taskTitle: post.task_title, category: post.category, content: post.content });
  const voice = {
    companionName: companion.name,
    personality: companion.personality,
    writingStyle: companion.writing_style,
    safetyInstructions: companion.safety_instructions,
    toneRules: companion.tone_rules,
    avoidRules: companion.avoid_rules,
  };
  const task = {
    postContent: (targetReply?.content ?? post.content).slice(0, 1200),
    taskTitle: post.task_title,
    category: post.category,
    taskCategory,
    streak: post.streak,
    xpEarned: post.xp_earned,
  };
  const context = await loadGenerationContext(planned.post_id, planned.companion_id);
  // A reply aimed at another reply may be a turn in a conversation this persona
  // is already having. Loading the branch decides which of the two prompts is
  // right: react to the task, or answer what was just said.
  const conversation = planned.kind === "reply" && planned.target_reply_id
    ? await loadThreadConversation(planned.target_reply_id, planned.companion_id)
    : null;

  if (planned.kind === "quote") {
    const author = post.author_id
      ? (await admin.from("user_profiles").select("username, display_name").eq("id", post.author_id).maybeSingle()).data
      : null;
    // A persona's own past quotes are screened at the stricter sibling bar: a
    // recognisable quote format repeated weekly is what makes the channel feel
    // automated, and quotes are rare enough to afford the higher standard.
    const attempt = await generateDistinctText({
      siblingReplies: context.recentQuotes,
      personaRecentReplies: context.recentQuotes,
      sourceTexts: [task.taskTitle, task.postContent],
      maxCharacters: 320,
      generate: (avoid) => provider.generateQuoteRepost({
        ...voice,
        ...task,
        quoteStyle: companion.quote_style,
        authorLabel: author?.display_name?.trim() || (author?.username ? `@${author.username}` : null),
        recentQuotes: avoid,
      }),
    });
    // A quote repost is standalone feed content, so there is no canned version
    // worth publishing. Nothing at all is the better outcome.
    if (!attempt.content) {
      const reason = `quote rejected: ${attempt.rejectionReason ?? "no usable generation"}`;
      logEngagement({
        event: "quote_rejected", engagementId, postId: planned.post_id, companionId: planned.companion_id,
        taskCategory, attempts: attempt.attempts, reason, promptVersion: PERSONA_ENGAGEMENT_PROMPT_VERSION,
      });
      const { error } = await admin.rpc("cancel_social_action", { p_job_id: job.id, p_lease_token: lease, p_reason: reason });
      if (error) throw error;
      return { id: job.id, status: "quote_cancelled" };
    }
    const { data: finalized, error } = await admin.rpc("finalize_social_action", {
      p_job_id: job.id,
      p_lease_token: lease,
      p_content: attempt.content,
    });
    if (error) throw error;
    if (!finalized) throw new Error("The social action lease expired or its target became unavailable.");
    logEngagement({
      event: "quote_published", engagementId, postId: planned.post_id, companionId: planned.companion_id,
      taskCategory, attempts: attempt.attempts, promptVersion: PERSONA_ENGAGEMENT_PROMPT_VERSION,
    });
    return { id: job.id, status: "quoted" };
  }

  const fallback = usableFallback([
    planned.fallback_content,
    companion.fallback_replies[0],
    fallbackReply(companion, { taskTitle: post.task_title, category: post.category }),
  ], [task.taskTitle, task.postContent]);
  const attempt = await generateDistinctText({
    siblingReplies: context.siblingReplies,
    personaRecentReplies: context.recentReplies,
    sourceTexts: [task.taskTitle, task.postContent],
    generate: (avoid) => conversation
      ? provider.generateThreadReply({
        ...voice,
        replyStyle: companion.reply_style,
        post: conversation.post,
        taskCategory,
        turns: conversation.turns,
        recentReplies: avoid,
      })
      : provider.generateReply({
        ...voice,
        ...task,
        replyStyle: companion.reply_style,
        siblingReplies: context.siblingReplies,
        recentReplies: avoid,
      }),
  }).catch((error: unknown) => ({
    content: null,
    attempts: 1,
    rejectionReason: error instanceof Error ? error.message : "provider_error",
  }));

  // Optional beta engagement stays silent when the provider cannot produce a
  // distinct in-character response. Historical guarantee rows keep their
  // fallback behavior while they drain after an upgrade.
  if (!attempt.content && planned.source !== "human_post_guarantee") {
    const reason = `reply rejected: ${attempt.rejectionReason ?? "no usable generation"}`;
    logEngagement({
      event: "reply_rejected", engagementId, postId: planned.post_id, companionId: planned.companion_id,
      taskCategory, attempts: attempt.attempts, reason, promptVersion: PERSONA_ENGAGEMENT_PROMPT_VERSION,
      mode: conversation ? "conversation" : "reaction", threadDepth: conversation?.depth,
    });
    const { error } = await admin.rpc("cancel_social_action", { p_job_id: job.id, p_lease_token: lease, p_reason: reason });
    if (error) throw error;
    return { id: job.id, status: "reply_cancelled" };
  }

  const content = attempt.content ?? fallback;
  const { data: finalized, error } = await admin.rpc("finalize_social_action", {
    p_job_id: job.id,
    p_lease_token: lease,
    p_content: content,
  });
  if (error) throw error;
  if (!finalized) throw new Error("The social action lease expired or its target became unavailable.");
  logEngagement({
    event: "reply_published", engagementId, postId: planned.post_id, companionId: planned.companion_id,
    taskCategory, source: planned.source, attempts: attempt.attempts,
    generated: Boolean(attempt.content), promptVersion: PERSONA_ENGAGEMENT_PROMPT_VERSION,
    mode: conversation ? "conversation" : "reaction", threadDepth: conversation?.depth,
  });
  return { id: job.id, status: attempt.content ? "replied" : "fallback" };
}

/**
 * Decides which personas notice a completed task. Ranking is
 * deterministic and runs entirely without the provider, so a post costs model
 * calls only for the few characters that actually chose to say something.
 */
async function planPostEngagement(job: AIJob, lease: string) {
  const admin = createAdminClient();
  const { postId, excludeCompanionId } = payload(job);
  if (!postId) throw new Error("Malformed engagement planning payload.");

  const { data, error } = await admin.rpc("get_post_engagement_context", { p_post_id: postId });
  if (error) throw error;
  const context = data as PostEngagementContext | null;

  const complete = async (status: string, planned = 0) => {
    const { error: completeError } = await admin.rpc("complete_ai_job", { p_job_id: job.id, p_lease_token: lease });
    if (completeError) throw completeError;
    return { id: job.id, status, planned };
  };

  if (!context || !canPlanPersonaEngagement({
    kind: context.post.kind,
    visibility: context.post.visibility,
    contentStatus: context.post.contentStatus,
  })) {
    return complete("engagement_skipped");
  }

  const plan = planPersonaEngagement({
    post: {
      id: context.post.id,
      authorId: context.post.authorId,
      taskTitle: context.post.taskTitle,
      category: context.post.category,
      content: context.post.content,
      streak: context.post.streak,
      xpEarned: context.post.xpEarned,
      focusMinutes: context.post.focusMinutes,
    },
    companions: context.companions.map((companion) => ({
      id: companion.id,
      slug: companion.slug,
      active: companion.active,
      isFavorite: companion.isFavorite,
      socialActivity: companion.socialActivity,
      likeAffinity: Number(companion.likeAffinity),
      replyAffinity: Number(companion.replyAffinity),
      quoteAffinity: Number(companion.quoteAffinity),
      categoryAffinity: companion.categoryAffinity,
    })),
    activity: Object.fromEntries(context.companions.map((companion) => [companion.id, {
      engagedThisPost: companion.engagedThisPost,
      repliesToAuthorRecently: Number(companion.repliesToAuthorRecently),
      quotesRecently: Number(companion.quotesRecently),
    }])),
    flags: personaEngagementChannels(context.post, context.flags),
    limits: configuredEngagementLimits(),
    excludeCompanionIds: excludeCompanionId ? [excludeCompanionId] : [],
  });

  for (const engagement of plan) {
    const kind = ACTION_KIND[engagement.action];
    const { error: enqueueError } = await admin.rpc("enqueue_social_action", {
      p_dedupe_key: `human-post:engage:${engagement.action}:${engagement.postId}:${engagement.companionId}`,
      p_source: "human_post_engagement",
      p_kind: kind,
      p_post_id: engagement.postId,
      p_companion_id: engagement.companionId,
      p_target_reply_id: null,
      p_scheduled_for: new Date(Date.now() + engagement.delaySeconds * 1000).toISOString(),
      p_decision: { ...engagement.reason, action: engagement.action, promptVersion: PERSONA_ENGAGEMENT_PROMPT_VERSION },
    });
    if (enqueueError) throw enqueueError;
  }

  logEngagement({
    event: "engagement_planned",
    postId,
    considered: context.companions.length,
    planned: plan.map((engagement) => ({ companionId: engagement.companionId, action: engagement.action, ...engagement.reason })),
  });
  return complete("engagement_planned", plan.length);
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
      if (job.job_type === "plan_post_engagement") return await planPostEngagement(job, lease);
      throw new Error(`Unsupported job type: ${job.job_type}`);
    } catch (error) {
      return failJob(job, lease, error);
    }
  }));
  return results as unknown as Json;
}

/**
 * Scheduled drains alone can leave a completion waiting until the next cron
 * tick. This kicks a small, priority-ordered drain after the response is sent
 * so any selected action can land promptly. It never blocks or fails the write;
 * the scheduled worker remains the durable path.
 */
export function drainAfterHumanEngagement(limit = 2) {
  after(async () => {
    try {
      await drainAIJobs(limit);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        scope: "ai_worker_inline",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  });
}
