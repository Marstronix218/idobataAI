import { assertDatabase, authed, ok, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50));
    return ok(assertDatabase(await supabase.from("public_task_progress").select("*").order("updated_at", { ascending: false }).limit(limit)));
  });
}

