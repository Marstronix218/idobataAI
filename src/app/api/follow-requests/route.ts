import { z } from "zod";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

const followRequestResponseSchema = z.object({
  requesterId: z.uuid(),
  accept: z.boolean(),
}).strict();

export async function GET(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const requests = assertDatabase(await supabase.rpc("get_follow_requests", { p_limit: 50 }));
    return ok({ requests });
  });
}

export async function PUT(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, followRequestResponseSchema);
    // Accepting inserts the follow edge and clears the request in one
    // transaction, so a half-approved state cannot be observed.
    const state = assertDatabase(await supabase.rpc("respond_follow_request", {
      p_requester_id: input.requesterId,
      p_accept: input.accept,
    }));
    return ok({ state });
  });
}
