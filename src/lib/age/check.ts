import "server-only";

import { AGE_CHECK_ERROR_CODES, type AgeCheckInput } from "@idobata/contracts";
import { ApiError } from "@/lib/server/http";
import { AgeVerifierConfigurationError, getAgeVerifier } from "./verifier";

const UNAVAILABLE_MESSAGE = "Age verification is not available right now. Please try again later.";

/** Logs why verification is unavailable, never the input: the date of birth must not reach a log. */
function logUnavailable(reason: string, error?: unknown) {
  console.error(JSON.stringify({
    level: "error",
    scope: "age_verification",
    reason,
    // A configuration message names env vars only; a provider's message could
    // echo its input, so only its class name is kept.
    ...(error instanceof AgeVerifierConfigurationError ? { message: error.message } : error instanceof Error ? { name: error.name } : {}),
  }));
}

/**
 * Runs the configured AgeVerifier and returns its method on a pass. Otherwise
 * throws the API error both age routes answer with: 403 `age_requirement`
 * (under 18), 422 `invalid_date_of_birth`, or 503
 * `age_verification_unavailable` (misconfigured or failing provider).
 */
export async function requireAdult(input: AgeCheckInput): Promise<string> {
  let verifier;
  try {
    verifier = getAgeVerifier();
  } catch (error) {
    logUnavailable("misconfigured", error);
    throw new ApiError(503, UNAVAILABLE_MESSAGE, AGE_CHECK_ERROR_CODES.unavailable);
  }

  let result;
  try {
    result = await verifier.verify({ dateOfBirth: input.dateOfBirth, timeZone: input.timeZone });
  } catch (error) {
    logUnavailable("provider_error", error);
    throw new ApiError(503, UNAVAILABLE_MESSAGE, AGE_CHECK_ERROR_CODES.unavailable);
  }

  if (result.ok) return result.method;
  if (result.reason === "under_18") throw new ApiError(403, "You need to be 18 or older to use idobata.", AGE_CHECK_ERROR_CODES.ageRequirement);
  if (result.reason === "invalid") throw new ApiError(422, "Enter your real date of birth.", AGE_CHECK_ERROR_CODES.invalidDateOfBirth);
  logUnavailable("provider_unavailable");
  throw new ApiError(503, UNAVAILABLE_MESSAGE, AGE_CHECK_ERROR_CODES.unavailable);
}
