import "server-only";

import { checkDateOfBirth, earliestToday } from "@/lib/domain/age";
import { isProductionEnvironment, isSelfAttestedAgeAllowed } from "./environment";

export { isProductionEnvironment, isSelfAttestedAgeAllowed };

export interface AgeVerificationInput {
  /** `YYYY-MM-DD`. Never stored or logged. */
  dateOfBirth: string;
  /**
   * The user's IANA zone. Accepted for compatibility, but the self-attested
   * check ignores it: "today" is the earliest date anywhere (UTC-12), so no
   * zone lets anyone pass early.
   */
  timeZone?: string;
}

export type AgeVerificationResult =
  | { ok: true; method: string }
  | { ok: false; reason: "under_18" | "invalid" | "unavailable" };

/** SPEC Phase 5: the age gate, behind an interface so a real provider can replace self-attestation. */
export interface AgeVerifier {
  /** Recorded as `age_verification_method`; at most 40 characters. */
  readonly method: string;
  verify(input: AgeVerificationInput): Promise<AgeVerificationResult>;
}

/** The deployment is set up wrongly: say so in the logs, answer 503, never fall back. */
export class AgeVerifierConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgeVerifierConfigurationError";
  }
}

/**
 * Trusts the date of birth the user types. For development and staging only:
 * `getAgeVerifier()` refuses it unless ALLOW_SELF_ATTESTED_AGE=true on a
 * deployment known not to be production. Someone whose 18th birthday is today
 * passes once it is that date everywhere (UTC-12), never earlier.
 */
export class SelfAttestedVerifier implements AgeVerifier {
  readonly method = "self_attested";

  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify({ dateOfBirth }: AgeVerificationInput): Promise<AgeVerificationResult> {
    const check = checkDateOfBirth(dateOfBirth, earliestToday(this.now()));
    if (!check.ok) return { ok: false, reason: "invalid" };
    return check.adult ? { ok: true, method: this.method } : { ok: false, reason: "under_18" };
  }
}

export const AGE_VERIFIERS = ["self_attested"] as const;

/**
 * The verifier named by `AGE_VERIFIER` (default `self_attested`). Throws
 * AgeVerifierConfigurationError for an unknown name, and for `self_attested`
 * unless isSelfAttestedAgeAllowed (ALLOW_SELF_ATTESTED_AGE=true outside
 * production; see isProductionEnvironment).
 */
export function getAgeVerifier(env: Record<string, string | undefined> = process.env): AgeVerifier {
  const name = env.AGE_VERIFIER?.trim() || "self_attested";
  // TODO(founder): choose provider — production must use a real age-verification provider (SPEC Phase 5)
  if (name === "self_attested") {
    if (!isSelfAttestedAgeAllowed(env)) {
      throw new AgeVerifierConfigurationError(isProductionEnvironment(env)
        ? "AGE_VERIFIER=self_attested is not allowed in production; configure a real age-verification provider."
        : "AGE_VERIFIER=self_attested needs ALLOW_SELF_ATTESTED_AGE=true (development and staging only).");
    }
    return new SelfAttestedVerifier();
  }
  throw new AgeVerifierConfigurationError(`Unknown AGE_VERIFIER "${name}". Expected one of: ${AGE_VERIFIERS.join(", ")}.`);
}
