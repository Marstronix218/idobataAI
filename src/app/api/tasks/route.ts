import { taskCreateSchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const category = url.searchParams.get("category");
    if (status && !["pending", "completed"].includes(status)) throw new ApiError(400, "Invalid task status.");
    let query = supabase.from("tasks").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(200);
    if (status) query = query.eq("status", status as "pending" | "completed");
    if (category) query = query.eq("category", category.slice(0, 48));
    return ok(assertDatabase(await query));
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const input = await parseJson(request, taskCreateSchema);
    let visibility = input.visibility;
    if (!visibility) {
      const profile = assertDatabase(await supabase.from("user_profiles").select("default_task_visibility").eq("id", user.id).single(), true);
      if (!profile) throw new ApiError(404, "Profile not found.", "not_found");
      visibility = profile.default_task_visibility;
    }
    const result = await supabase.from("tasks").insert({
      owner_id: user.id, title: input.title, description: input.description ?? null, category: input.category ?? null,
      due_at: input.dueAt ?? null, recurrence_rule: input.recurrenceRule ?? null,
      recurrence_instance_id: null, visibility,
    }).select("*").single();
    return ok(assertDatabase(result), { status: 201 });
  });
}
