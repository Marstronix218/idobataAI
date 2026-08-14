export type EngagementKind = "reply" | "reaction";

export interface EligibleCompanion {
  id: string;
  active: boolean;
  muted?: boolean;
}

export interface PlannedEngagement {
  postId: string;
  companionId: string;
  slot: number;
  kind: EngagementKind;
}

export interface EngagementPlanInput {
  postId: string;
  companions: EligibleCompanion[];
  maxCount?: number;
}

function stableScore(postId: string, companionId: string) {
  let score = 2166136261;
  const value = `${postId}:${companionId}`;
  for (let index = 0; index < value.length; index += 1) {
    score ^= value.charCodeAt(index);
    score = Math.imul(score, 16777619);
  }
  return score >>> 0;
}

export function planOptionalEngagements({
  postId,
  companions,
  maxCount = 0,
}: EngagementPlanInput): PlannedEngagement[] {
  const eligible = companions
    .filter((companion) => companion.active && !companion.muted)
    .sort((left, right) => stableScore(postId, left.id) - stableScore(postId, right.id));

  return eligible.slice(0, Math.max(0, maxCount)).map((companion, index) => ({
    postId,
    companionId: companion.id,
    slot: index + 1,
    kind: index === 2 ? "reaction" : "reply",
  }));
}
