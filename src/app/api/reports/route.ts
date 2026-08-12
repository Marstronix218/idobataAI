import { reportSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function POST(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, reportSchema);
    const result = await supabase.rpc("report_content", { p_post_id: input.postId ?? null, p_reply_id: input.replyId ?? null, p_reason: input.reason });
    return ok({ id: assertDatabase(result) }, { status: 201 });
  });
}

