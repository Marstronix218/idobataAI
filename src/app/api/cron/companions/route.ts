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
    const planned = assertDatabase(await createAdminClient().rpc("reconcile_persona_engagements", { p_date: date }));
    return ok({ date, planned });
  });
}
