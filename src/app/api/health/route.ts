import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// An external uptime monitor had nothing to point at: no route could answer
// "is the app up and can it reach Postgres?". Unauthenticated on purpose, and
// deliberately free of any detail that would help probe the system.
export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  let database: "ok" | "unavailable" | "unconfigured" = "unconfigured";
  try {
    const supabase = createClient(supabaseUrl(), supabaseAnonKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase
      .from("social_companions")
      .select("id", { count: "exact", head: true })
      .abortSignal(AbortSignal.timeout(3_000))
      .limit(1);
    // RLS refusing an anonymous read still proves the database answered.
    database = error && !error.code ? "unavailable" : "ok";
  } catch {
    database = "unavailable";
  }
  const healthy = database === "ok";
  return Response.json(
    { status: healthy ? "ok" : "degraded", database, commit },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
