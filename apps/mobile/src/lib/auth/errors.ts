export type AuthResult = {
  error: string | null;
  requiresEmailConfirmation?: boolean;
  existingAccount?: boolean;
};

export function friendlyAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) return "That email and password do not match.";
  if (lower.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (lower.includes("network")) return "We could not reach Idobata. Check your connection and try again.";
  return message;
}

export async function guardAuthResult(operation: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await operation();
  } catch {
    return {
      error: "Your secure session could not be updated. Check your device storage and try again.",
    };
  }
}

/**
 * Supabase will not say "that email is taken" while email enumeration
 * protection is on: signUp for an existing confirmed address resolves without
 * an error, returning an obfuscated user carrying no identities and no
 * session. Left undetected it reads as a fresh signup, and the person who
 * already has an account waits for a confirmation mail that never arrives.
 */
export function isExistingAccountSignUp(data: {
  user: { identities?: unknown[] | null } | null;
  session: unknown | null;
}) {
  return !data.session && data.user !== null && (data.user.identities?.length ?? 0) === 0;
}

/** The same case when enumeration protection is off and Supabase says so plainly. */
export function isExistingAccountError(error: { code?: string; message: string } | null) {
  if (!error) return false;
  if (error.code === "user_already_exists") return true;
  return /already\s+(been\s+)?registered|already\s+exists/i.test(error.message);
}
