// Launch-check fixture: a real provider is registered and is the default;
// self-attestation stays behind its guard for local development.
export const AGE_VERIFIERS = ["fixture_provider", "self_attested"] as const;

function isSelfAttestedAgeAllowed(env: Record<string, string | undefined>) {
  return env.ALLOW_SELF_ATTESTED_AGE?.trim() === "true";
}

export function getAgeVerifierName(env: Record<string, string | undefined>) {
  const name = env.AGE_VERIFIER?.trim() || "fixture_provider";
  if (name === "self_attested" && !isSelfAttestedAgeAllowed(env)) throw new Error("self_attested is not allowed here");
  return name;
}
