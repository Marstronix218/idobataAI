import { ApiClientError, type ApiClient } from "@idobata/api-client";
import { AGE_CHECK_ERROR_CODES } from "@idobata/contracts";

/**
 * The outcome of the age check before a sign-up (PLAN D5):
 * - `token`: pass it to signUp as `options.data.age_token`.
 * - `legacy`: sign up without a token. Pivot A is off (404), or the check
 *   could not be reached (offline, timeout, 5xx); the server's auth hook and
 *   sign-up backstop still refuse an account that needed a token.
 * - `blocked`: under 18; create no account.
 * - `error`: show the message and let the user try again.
 */
export type SignUpAgeCheck =
  | { kind: "token"; token: string }
  | { kind: "legacy" }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

const DATE_OF_BIRTH = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOfBirthFormat(value: string) {
  return DATE_OF_BIRTH.test(value.trim());
}

/** The device's IANA time zone; undefined lets the server decide. */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Unreachable, timed out, or the server failed: nothing to show the user. */
function isUnavailable(error: unknown) {
  if (!(error instanceof ApiClientError)) return true;
  return error.status === 0 || error.status === 404 || error.status === 408 || error.status >= 500;
}

/**
 * Whether sign-up needs a date of birth (GET /api/auth/age-check), or null
 * when that cannot be told; the screen then signs up without one, and asks
 * again if the server refuses.
 */
export async function fetchAgeRequirement(client: Pick<ApiClient, "getAgeRequirement">): Promise<boolean | null> {
  try {
    return (await client.getAgeRequirement()).required;
  } catch {
    return null;
  }
}

export async function checkSignUpAge(
  client: Pick<ApiClient, "checkAge">,
  dateOfBirth: string,
  timeZone?: string,
): Promise<SignUpAgeCheck> {
  try {
    const { token } = await client.checkAge({ dateOfBirth: dateOfBirth.trim(), ...(timeZone ? { timeZone } : {}) });
    return { kind: "token", token };
  } catch (error) {
    if (isUnavailable(error)) return { kind: "legacy" };
    const apiError = error as ApiClientError;
    if (apiError.status === 403 && apiError.code === AGE_CHECK_ERROR_CODES.ageRequirement) return { kind: "blocked" };
    if (apiError.status === 422) return { kind: "error", message: "Enter your real date of birth as YYYY-MM-DD." };
    return { kind: "error", message: apiError.message };
  }
}
