import { createAdminClient } from "@/lib/supabase/admin";
import { assertPrivilegedRequest } from "@/lib/server/privileged";
import { assertDatabase, ok, withApi } from "@/lib/server/http";

export const maxDuration = 30;

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

function run(request: Request) {
  return withApi(async () => {
    assertPrivilegedRequest(request);
    const date = new Date().toISOString().slice(0, 10);
    const inserted = assertDatabase(await createAdminClient().rpc("schedule_companion_posts", { p_date: date }));
    return ok({ date, inserted });
  });
}

