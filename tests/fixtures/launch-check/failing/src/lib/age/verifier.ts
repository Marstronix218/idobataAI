// Launch-check fixture: only the self-attested verifier exists, and it is the default.
export const AGE_VERIFIERS = ["self_attested"] as const;

function isSelfAttestedAgeAllowed(env: Record<string, string | undefined>) {
  return env.ALLOW_SELF_ATTESTED_AGE?.trim() === "true";
}

export function getAgeVerifierName(env: Record<string, string | undefined>) {
  const name = env.AGE_VERIFIER?.trim() || "self_attested";
  // TODO(founder): choose provider
  if (name === "self_attested" && !isSelfAttestedAgeAllowed(env)) throw new Error("self_attested is not allowed here");
  return name;
}
