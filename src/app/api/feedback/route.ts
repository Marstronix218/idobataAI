import { feedbackSchema } from "@/lib/server/schemas";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function POST(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const input = await parseJson(request, feedbackSchema);
    const result = await supabase.rpc("submit_feedback", {
      p_category: input.category,
      p_message: input.message,
    });
    return ok({ id: assertDatabase(result) }, { status: 201 });
  });
}
