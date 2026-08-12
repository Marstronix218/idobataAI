import "server-only";

import { ApiError } from "./http";

export function assertPrivilegedRequest(request: Request) {
  const expected = [process.env.CRON_SECRET, process.env.WORKER_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  if (!expected.length) throw new ApiError(503, "Privileged route secret is not configured.", "not_configured");
  const authorization = request.headers.get("authorization");
  if (!expected.some((secret) => authorization === `Bearer ${secret}`)) {
    throw new ApiError(401, "Invalid privileged route credential.", "unauthorized");
  }
}
