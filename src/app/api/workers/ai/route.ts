import { z } from "zod";
import { drainAIJobs } from "@/lib/ai";
import { getFlags } from "@/lib/flags";
import { isGateOpen } from "@/lib/flags/route-gates";
import { assertPrivilegedRequest } from "@/lib/server/privileged";
import { ok, withApi } from "@/lib/server/http";

export const maxDuration = 60;

// The database caps a claim at 200. A scheduled drain needs to clear a full
// day of planned engagement in one run, not 25 jobs of it.
const limitSchema = z.coerce.number().int().min(1).max(200).catch(25);

async function run(request: Request) {
  return withApi(async () => {
    assertPrivilegedRequest(request);
    // Every queued job type is persona work. Rows stay queued, and SQL
    // finalization re-checks the flags when they are drained later.
    if (!isGateOpen(await getFlags(), "persona_engagement")) return ok({ skipped: "persona_engagement disabled" });
    const limit = limitSchema.parse(new URL(request.url).searchParams.get("limit") ?? 25);
    return ok({ jobs: await drainAIJobs(limit) });
  });
}

// Vercel Cron invokes configured paths with GET. POST remains available for a
// manually triggered worker drain using the same bearer credential.
export const GET = run;
export const POST = run;
