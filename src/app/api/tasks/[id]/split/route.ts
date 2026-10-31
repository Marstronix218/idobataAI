import { z } from "zod";
import { requireApiGate } from "@/lib/flags/route-gates";
import { splitTask } from "@/lib/reactions/splitter";
import { authed, ok, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

/**
 * Three small steps for one of the caller's tasks, in the character's voice,
 * or `{ kind: "crisis" }`. Errors: 402 `plan_required` (free plan), 409
 * `character_required`, 429 `split_cap_reached`, 503 `split_unavailable`.
 */
export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    const { user } = await authed(request);
    const id = idSchema.parse((await params).id);
    await enforceRateLimit(user.id, "tasks:split", 30, 3600);
    return ok(await splitTask(user.id, id));
  });
}
