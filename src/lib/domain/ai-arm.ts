import { createHash } from "node:crypto";

// The `ai_arm` experiment (SPEC Phase 7, PLAN D1): a sticky 50/50 split that
// applies to every user, paying users included. The arm is a pure function of
// the user id, so recomputing it always gives the same answer; the reaction
// engine stores it on user_coach_profiles the first time it is needed.

export type AiArm = "ai" | "prewritten";

/** "ai" when the first byte of SHA-256(user id) is even, "prewritten" when odd. */
export function assignAiArm(userId: string): AiArm {
  const firstByte = createHash("sha256").update(userId.trim().toLowerCase()).digest()[0];
  return firstByte % 2 === 0 ? "ai" : "prewritten";
}
