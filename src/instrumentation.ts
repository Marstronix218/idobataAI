/**
 * Boot-time configuration validation and a single server-side error hook.
 *
 * Previously the only environment check was lazy and per-request: a missing
 * `SUPABASE_SERVICE_ROLE_KEY` was not discovered until the first request that
 * needed an admin client, which then returned a generic 500 that nobody saw.
 * A misconfigured deploy should fail loudly at boot instead.
 *
 * `onRequestError` and the structured lines emitted here are intentionally
 * provider-agnostic: they write JSON to stdout, which a Vercel Log Drain or an
 * error reporter can consume by changing only this file.
 */

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

// Required only where a missing value silently disables a guarantee rather
// than failing visibly.
const REQUIRED_IN_PRODUCTION = ["APP_URL", "CRON_SECRET", "ACCOUNT_DELETION_AUDIT_SALT"] as const;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}.`);
  }

  if (process.env.NODE_ENV === "production") {
    const missingInProduction = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]?.trim());
    if (missingInProduction.length) {
      throw new Error(`Missing production environment variables: ${missingInProduction.join(", ")}.`);
    }
    if (process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true") {
      throw new Error("NEXT_PUBLIC_ENABLE_DEMO_MODE must not be set in production.");
    }
  }

  console.log(JSON.stringify({
    level: "info",
    scope: "boot",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    env: process.env.NODE_ENV,
  }));
}

export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string },
) {
  const detail = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
  console.error(JSON.stringify({
    level: "error",
    scope: "request",
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    ...detail,
  }));
}
