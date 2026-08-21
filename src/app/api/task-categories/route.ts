import { taskCategorySchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const result = await supabase
      .from("task_categories")
      .select("*")
      .eq("owner_id", user.id)
      .order("name", { ascending: true })
      .limit(100);
    return ok(assertDatabase(result));
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    await enforceRateLimit(user.id, "category:create", 60, 3600);
    const input = await parseJson(request, taskCategorySchema);
    const result = await supabase
      .from("task_categories")
      .insert({ owner_id: user.id, name: input.name })
      .select("*")
      .single();
    if (result.error?.code === "23505") {
      throw new ApiError(409, "You already have a category with that name.", "category_exists");
    }
    return ok(assertDatabase(result), { status: 201 });
  });
}
