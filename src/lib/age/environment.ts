// Which deployment this is, for rules that differ in production. Kept free of
// "server-only". `npm run launch-check` runs on plain Node with a copy of this
// rule, scripts/lib/age-environment.mjs; tests/domain/age-environment-script.test.ts
// keeps the two identical.

type Environment = Record<string, string | undefined>;

/** APP_ENV values that mean "not production". Any other value counts as production. */
export const NON_PRODUCTION_APP_ENVS: readonly string[] = ["development", "dev", "local", "test", "staging", "preview"];
/**
 * On a Vercel production deployment only these APP_ENV values make it
 * non-production (a staging project Vercel marks as production). A local or
 * test value there is a copied .env, not a real local run.
 */
export const VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS: readonly string[] = ["staging", "preview"];

/**
 * True unless this is known not to be production, so a typo fails closed.
 * - APP_ENV set: production unless it is one of NON_PRODUCTION_APP_ENVS
 *   (trimmed, any case). "prod", "live" or "Production" are production. When
 *   VERCEL_ENV is "production", only "staging" or "preview" count as
 *   non-production.
 * - APP_ENV unset, on Vercel: production when VERCEL_ENV is "production".
 * - APP_ENV and VERCEL_ENV unset (another host): production when NODE_ENV is
 *   "production". On Vercel NODE_ENV is "production" for previews too, which
 *   is why VERCEL_ENV decides there.
 */
export function isProductionEnvironment(env: Environment = process.env) {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (appEnv) {
    const allowed = vercelEnv === "production" ? VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS : NON_PRODUCTION_APP_ENVS;
    return !allowed.includes(appEnv);
  }
  if (vercelEnv) return vercelEnv === "production";
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

/**
 * Self-attestation (trusting a typed date of birth) needs an explicit opt-in,
 * ALLOW_SELF_ATTESTED_AGE=true, and a deployment known not to be production.
 */
export function isSelfAttestedAgeAllowed(env: Environment = process.env) {
  return env.ALLOW_SELF_ATTESTED_AGE?.trim() === "true" && !isProductionEnvironment(env);
}
