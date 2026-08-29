import type { AuthError, User } from "@supabase/supabase-js";

/**
 * Supabase deliberately refuses to say "that email is taken" when email
 * enumeration protection is on (the default): signUp for a confirmed address
 * resolves without an error, returning an obfuscated user with no identities
 * and no session. That is indistinguishable, to a naive caller, from a fresh
 * signup awaiting confirmation — so the person who already has an account gets
 * told to check an inbox for a mail that will never arrive.
 *
 * These two checks cover both server configurations: the obfuscated response
 * above, and the plain `user_already_exists` error raised when enumeration
 * protection is turned off.
 */
export function isExistingAccountSignUp(
  data: { user: User | null; session: unknown | null },
): boolean {
  return !data.session && data.user !== null && (data.user.identities?.length ?? 0) === 0;
}

export function isExistingAccountError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "user_already_exists") return true;
  return /already\s+(been\s+)?registered|already\s+exists/i.test(error.message);
}
