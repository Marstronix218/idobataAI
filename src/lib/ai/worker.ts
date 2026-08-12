import "server-only";

import type { AIJob, Json } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAIProvider } from "./provider";
import { resolveAIReply } from "@/lib/domain";

function payload(job: AIJob) { return job.payload as { replyId?: string; postId?: string; companionId?: string }; }

export async function drainAIJobs(limit = 5) {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_ai_jobs", { p_limit: limit, p_lease_seconds: 120 });
  if (error) throw error;
  const provider = getAIProvider();
  const results = await Promise.all((jobs ?? []).map(async (job) => {
    const lease = job.lease_token;
    if (!lease) return { id: job.id, status: "skipped" };
    try {
      if (job.job_type !== "enhance_reply") throw new Error(`Unsupported job type: ${job.job_type}`);
      const ids = payload(job);
      if (!ids.replyId || !ids.postId || !ids.companionId) throw new Error("Malformed job payload.");
      const [{ data: reply }, { data: post }, { data: companion }, { count: reports }] = await Promise.all([
        admin.from("social_replies").select("id, content, content_status").eq("id", ids.replyId).single(),
        admin.from("social_posts").select("id, content, content_status, task_title, category").eq("id", ids.postId).single(),
        admin.from("social_companions").select("id, name, personality, writing_style, safety_instructions, active").eq("id", ids.companionId).single(),
        admin.from("content_reports").select("id", { count: "exact", head: true }).eq("post_id", ids.postId),
      ]);
      if (!reply || !post || !companion || reply.content_status !== "active" || post.content_status !== "active" || !companion.active || reports) throw new Error("Engagement target is unavailable, reported, or unsafe.");
      const generated = await resolveAIReply({
        fallback: reply.content,
        generate: () => provider.generateReply({ companionName: companion.name, personality: companion.personality, writingStyle: companion.writing_style, safetyInstructions: companion.safety_instructions, postContent: post.content, taskTitle: post.task_title, category: post.category }),
      });
      if (generated.source === "provider") {
        const { data: finalized, error: finalizeError } = await admin.rpc("finalize_ai_reply_job", {
          p_job_id: job.id,
          p_lease_token: lease,
          p_content: generated.content,
        });
        if (finalizeError) throw finalizeError;
        if (!finalized) throw new Error("The AI job lease expired or its engagement target became unavailable.");
      } else throw new Error(`Provider enhancement failed; fallback remains visible. ${generated.error ?? "No provider detail."}`);
      return { id: job.id, status: generated.source === "provider" ? "enhanced" : "fallback" };
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : "Unknown job error";
      await admin.rpc("fail_ai_job", { p_job_id: job.id, p_lease_token: lease, p_error: message, p_cooldown_seconds: Math.min(3600, 60 * 2 ** job.attempts) });
      return { id: job.id, status: "failed" };
    }
  }));
  return results as unknown as Json;
}
