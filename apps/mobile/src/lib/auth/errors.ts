export type AuthResult = { error: string | null; requiresEmailConfirmation?: boolean };

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
