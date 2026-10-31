import { z } from "zod";
import type { ReactionPayload, TaskStartResult } from "@idobata/contracts";
import { requireApiGate } from "@/lib/flags/route-gates";
import { getReaction } from "@/lib/reactions/engine";
import { reactionRateLimitAllows } from "@/lib/reactions/rate-limit";
import { ApiError, assertDatabase, authed, ok, withApi } from "@/lib/server/http";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

/**
 * Records that the caller started one of their pending tasks (once per task
 * per local day; start_task has its own database rate limit) and returns the
 * character's reaction. A repeat start the same day returns the same event
 * with `reaction: null`. The reaction rate limit never blocks the start, and
 * never the crisis card: past it, only the safety checks run, so `reaction` is
 * { kind: "crisis" } for distress text and null otherwise. If anything goes
 * wrong with the reaction, it is null.
 */
export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    // The reaction's AI deadline counts from here, so the whole request stays inside it.
    const startedAt = Date.now();
    await requireApiGate("pivot_a");
    const { user, supabase } = await authed(request);
    const id = idSchema.parse((await params).id);

    const result = await supabase.rpc("start_task", { p_task_id: id });
    if (result.error?.code === "22023") throw new ApiError(409, "This task is already done.", "task_not_pending");
    const event = assertDatabase(result);
    if (!event) throw new Error("start_task returned no event.");

    let reaction: ReactionPayload | null = null;
    try {
      const banter = await reactionRateLimitAllows(user.id);
      reaction = await getReaction(user.id, event.id, { startedAt, safetyOnly: !banter });
    } catch {
      reaction = null;
    }

    const body: TaskStartResult = { event: { id: event.id, type: "started", occurredAt: event.occurred_at }, reaction };
    return ok(body);
  });
}
