import { describe, expect, it } from "vitest";

import { planGuaranteedEngagements } from "@/lib/domain/engagement-plan";

type EngagementPlanInput = Parameters<typeof planGuaranteedEngagements>[0];

const companions = [
  { id: "companion-1", active: true, muted: false },
  { id: "companion-2", active: true, muted: false },
  { id: "companion-3", active: true, muted: false },
  { id: "companion-inactive", active: false, muted: false },
  { id: "companion-muted", active: true, muted: true },
];

const input = {
  postId: "post-1",
  companions,
  count: 3,
} as unknown as EngagementPlanInput;

describe("planGuaranteedEngagements", () => {
  it("creates three durable engagement slots", () => {
    expect(planGuaranteedEngagements(input)).toHaveLength(3);
  });

  it("selects a different companion for every slot", () => {
    const plan = planGuaranteedEngagements(input) as Array<{ companionId: string }>;

    expect(new Set(plan.map(({ companionId }) => companionId)).size).toBe(3);
  });

  it("excludes inactive and muted companions", () => {
    const plan = planGuaranteedEngagements(input) as Array<{ companionId: string }>;

    expect(plan.map(({ companionId }) => companionId)).toEqual(
      expect.not.arrayContaining(["companion-inactive", "companion-muted"]),
    );
  });

  it("creates two reply slots and one reaction slot", () => {
    const plan = planGuaranteedEngagements(input);

    expect(plan.map(({ kind }) => kind).sort()).toEqual([
      "reaction",
      "reply",
      "reply",
    ]);
  });

  it("assigns a unique idempotency slot to every engagement", () => {
    const plan = planGuaranteedEngagements(input);

    expect(new Set(plan.map(({ slot }) => slot)).size).toBe(3);
  });

  it("creates only as many slots as eligible companions permit", () => {
    const limitedInput = {
      ...input,
      companions: companions.slice(0, 2),
    } as EngagementPlanInput;

    expect(planGuaranteedEngagements(limitedInput)).toHaveLength(2);
  });

  it("returns the same plan when publication is retried", () => {
    expect(planGuaranteedEngagements(input)).toEqual(
      planGuaranteedEngagements({ ...input }),
    );
  });
});
