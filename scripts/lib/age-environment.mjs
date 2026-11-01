// A copy of src/lib/age/environment.ts (the production rule behind
// getAgeVerifier), so `npm run launch-check` runs on plain Node without
// importing TypeScript. tests/domain/age-environment-script.test.ts keeps the
// two identical.

/** APP_ENV values that mean "not production". Any other value counts as production. */
export const NON_PRODUCTION_APP_ENVS = ["development", "dev", "local", "test", "staging", "preview"];
/** On a Vercel production deployment only these APP_ENV values make it non-production. */
export const VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS = ["staging", "preview"];

/**
 * True unless this is known not to be production, so a typo fails closed.
 * @param {Record<string, string | undefined>} env
 */
export function isProductionEnvironment(env) {
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
 * Self-attestation needs ALLOW_SELF_ATTESTED_AGE=true and a deployment known
 * not to be production.
 * @param {Record<string, string | undefined>} env
 */
export function isSelfAttestedAgeAllowed(env) {
  return env.ALLOW_SELF_ATTESTED_AGE?.trim() === "true" && !isProductionEnvironment(env);
}
