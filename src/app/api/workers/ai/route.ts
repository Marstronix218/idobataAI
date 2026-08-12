import { z } from "zod";
import { drainAIJobs } from "@/lib/ai";
import { assertPrivilegedRequest } from "@/lib/server/privileged";
import { ok, withApi } from "@/lib/server/http";

export const maxDuration = 60;

const limitSchema = z.coerce.number().int().min(1).max(25).catch(5);

async function run(request: Request) {
  return withApi(async () => {
    assertPrivilegedRequest(request);
    const limit = limitSchema.parse(new URL(request.url).searchParams.get("limit") ?? 5);
    return ok({ jobs: await drainAIJobs(limit) });
  });
}

// Vercel Cron invokes configured paths with GET. POST remains available for a
// manually triggered worker drain using the same bearer credential.
export const GET = run;
export const POST = run;
