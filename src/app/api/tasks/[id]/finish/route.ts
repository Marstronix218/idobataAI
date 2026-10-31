import { z } from "zod";
import type { ReactionPayload, TaskFinishResult } from "@idobata/contracts";
import { isAgeVerified } from "@/lib/coach/age";
import { requireApiGate } from "@/lib/flags/route-gates";
import { logAiEvent } from "@/lib/ai/anthropic";
import { getReaction } from "@/lib/reactions/engine";
import { reactionRateLimitAllows } from "@/lib/reactions/rate-limit";
import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";
import { updateOwnTask } from "@/lib/server/task-update";
import type { Task } from "@/types";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

const sameInstant = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(a) === Date.parse(b);

/**
 * Marks one of the caller's tasks completed, exactly as PATCH
 * /api/tasks/[id] with `{ status: "completed" }` does, and returns the task
 * with the character's reaction. Once the completion has committed the
 * request always succeeds: the reaction is null when the task was already
 * completed, this completion recorded no new finished event (the same
 * occurrence was finished before), no character is selected, or anything
 * about the reaction fails. Past the reaction rate limit only the safety
 * checks run: the crisis card still shows for distress text, banter doesn't.
 */
export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    // The reaction's AI deadline counts from here, so the whole request stays inside it.
    const startedAt = Date.now();
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);

    const prior = assertDatabase(await supabase.from("tasks").select("*").eq("id", id).eq("owner_id", user.id).single(), true) as Task;
    if (prior.status === "completed") return ok({ task: prior, reaction: null } satisfies TaskFinishResult);

    const task = await updateOwnTask(supabase, user.id, id, { status: "completed" });

    // The task is completed now; nothing below may turn that into an error.
    let reaction: ReactionPayload | null = null;
    try {
      // The task is never held back for the age, and the crisis card still
      // shows; banter needs a verified age (an unknown age counts as unverified).
      const verified = await isAgeVerified(supabase, user.id).catch(() => false);
      const banter = verified && await reactionRateLimitAllows(user.id);
      // The finish trigger keys events like XP awards: one per occurrence.
      // The event is new only if this completion wrote it, i.e. it carries
      // this completion's timestamp; a reopened-and-redone occurrence keeps the old one.
      const finished = await supabase
        .from("task_events")
        .select("id, occurred_at")
        .eq("task_id", id)
        .eq("type", "finished")
        .eq("occurrence_key", task.recurrence_instance_id ?? "single")
        .maybeSingle();
      if (finished.error) throw new Error(`finished event lookup failed: ${finished.error.code ?? ""}`);
      if (finished.data && sameInstant(finished.data.occurred_at, task.completed_at)) {
        reaction = await getReaction(user.id, finished.data.id, { startedAt, safetyOnly: !banter });
      }
    } catch (error) {
      logAiEvent("error", "reactions", { message: "finish reaction skipped", error: error instanceof Error ? error.message : String(error) });
      reaction = null;
    }

    return ok({ task, reaction } satisfies TaskFinishResult);
  });
}
