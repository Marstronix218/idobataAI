import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** How long a sign-up age token stays valid (PLAN D5). */
export const AGE_TOKEN_TTL_MS = 15 * 60_000;

/**
 * Lowercase hex sha256 of the token's UTF-8 bytes. Must match the database:
 * `encode(sha256(convert_to(token, 'UTF8')), 'hex')` in
 * public.hook_before_user_created.
 */
export function hashAgeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A random 32-byte base64url token, its hash (the only thing stored) and its expiry. */
export function createAgeToken(now: Date = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAgeToken(token), expiresAt: new Date(now.getTime() + AGE_TOKEN_TTL_MS) };
}
