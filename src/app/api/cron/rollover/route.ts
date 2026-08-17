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

// Returns completed recurring tasks to pending once their occurrence has passed.
// Scheduled daily because the Hobby plan allows no finer cadence; the RPC is
// idempotent within an occurrence, so move this to `0 * * * *` on a plan that
// supports it and routines become ready closer to each user's own morning.
function run(request: Request) {
  return withApi(async () => {
    assertPrivilegedRequest(request);
    const date = new Date().toISOString().slice(0, 10);
    const rolled = assertDatabase(await createAdminClient().rpc("rollover_recurring_tasks", { p_date: date }));
    return ok({ date, rolled });
  });
}
