import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assignAiArm } from "@/lib/domain/ai-arm";
import { resolvePlan, withBetaFullAccess, type EntitlementRow } from "@/lib/domain/plan";

const now = new Date("2026-10-31T12:00:00Z");
const row = (overrides: Partial<EntitlementRow>): EntitlementRow => ({ product: "plus", status: "active", trial_ends_at: null, current_period_end: null, ...overrides });

describe("resolvePlan", () => {
  it("is free with no entitlements", () => {
    expect(resolvePlan([], now)).toEqual({ tier: "free", packs: [] });
  });

  it("is plus for an active plus row with no end or a future end", () => {
    expect(resolvePlan([row({})], now).tier).toBe("plus");
    expect(resolvePlan([row({ current_period_end: "2026-11-30T00:00:00Z" })], now).tier).toBe("plus");
  });

  it("is free once the paid period has ended, or for a lapsed status", () => {
    expect(resolvePlan([row({ current_period_end: "2026-10-30T00:00:00Z" })], now).tier).toBe("free");
    for (const status of ["past_due", "canceled", "expired", "refunded"]) expect(resolvePlan([row({ status })], now).tier).toBe("free");
  });

  it("is trial while trialing with no end or a future trial end", () => {
    expect(resolvePlan([row({ status: "trialing" })], now).tier).toBe("trial");
    expect(resolvePlan([row({ status: "trialing", trial_ends_at: "2026-11-14T00:00:00Z" })], now).tier).toBe("trial");
    expect(resolvePlan([row({ status: "trialing", trial_ends_at: "2026-10-31T11:59:59Z" })], now).tier).toBe("free");
  });

  it("prefers plus over a trial from another source", () => {
    expect(resolvePlan([row({ status: "trialing" }), row({})], now).tier).toBe("plus");
    expect(resolvePlan([row({}), row({ status: "trialing" })], now).tier).toBe("plus");
  });

  it("fails closed on an unreadable date", () => {
    expect(resolvePlan([row({ current_period_end: "soon" })], now).tier).toBe("free");
  });

  it("lists active packs by slug, without affecting the tier", () => {
    const plan = resolvePlan([
      row({ product: "pack:night-owl" }),
      row({ product: "pack:early-bird" }),
      row({ product: "pack:refunded-one", status: "refunded" }),
      row({ product: "pack:night-owl" }),
    ], now);
    expect(plan).toEqual({ tier: "free", packs: ["early-bird", "night-owl"] });
  });
});

describe("withBetaFullAccess", () => {
  const on = { pivotA: true, betaFullAccess: true };

  it("raises free and trial to Plus, marked beta, keeping owned packs", () => {
    expect(withBetaFullAccess({ tier: "free", packs: [] }, on)).toEqual({ tier: "plus", packs: [], beta: true });
    expect(withBetaFullAccess({ tier: "trial", packs: ["night-owl"] }, on)).toEqual({ tier: "plus", packs: ["night-owl"], beta: true });
  });

  it("leaves a paying Plus user as they are, and grants no packs", () => {
    const plus = resolvePlan([row({}), row({ product: "pack:early-bird" })], now);
    expect(withBetaFullAccess(plus, on)).toBe(plus);
    expect(withBetaFullAccess({ tier: "free", packs: [] }, on).packs).toEqual([]);
  });

  it("does nothing unless both Pivot A and the flag are on", () => {
    const free = { tier: "free" as const, packs: [] };
    expect(withBetaFullAccess(free, { pivotA: false, betaFullAccess: true })).toBe(free);
    expect(withBetaFullAccess(free, { pivotA: true, betaFullAccess: false })).toBe(free);
  });
});

describe("assignAiArm", () => {
  const ids = Array.from({ length: 2000 }, (_, index) => `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);

  it("is deterministic and ignores case and surrounding space", () => {
    const id = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(assignAiArm(id)).toBe(assignAiArm(id));
    expect(assignAiArm(` ${id.toLowerCase()} `)).toBe(assignAiArm(id));
  });

  it("splits users roughly 50/50", () => {
    const ai = ids.filter((id) => assignAiArm(id) === "ai").length;
    expect(ai / ids.length).toBeGreaterThan(0.45);
    expect(ai / ids.length).toBeLessThan(0.55);
  });

  it("only ever answers ai or prewritten", () => {
    expect(new Set(ids.map(assignAiArm))).toEqual(new Set(["ai", "prewritten"]));
  });

  // 10,000 well-mixed v4-shaped ids from a fixed seed, so the run is
  // deterministic. For a fair split the share of "ai" has a standard deviation
  // of 0.005; 0.48-0.52 is four of them either side.
  it("splits many random-looking ids 50/50 within four standard deviations", () => {
    const randomIds = Array.from({ length: 10_000 }, (_, index) => {
      const hex = createHash("sha256").update(`ai-arm-seed:${index}`).digest("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    });
    const share = randomIds.filter((id) => assignAiArm(id) === "ai").length / randomIds.length;
    expect(share).toBeGreaterThan(0.48);
    expect(share).toBeLessThan(0.52);
  });

  it("is sticky: the same user always lands in the same arm", () => {
    for (const id of ids.slice(0, 200)) {
      const first = assignAiArm(id);
      for (let attempt = 0; attempt < 3; attempt += 1) expect(assignAiArm(id.toUpperCase())).toBe(first);
    }
  });

  // The same ids and arms as supabase/tests/pivot_a_metrics.sql, which checks
  // that coach_ai_arm() (the database's assignment for new coach profiles)
  // gives these answers too, so both sides always agree.
  it.each([
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ai"],
    ["00000000-0000-4000-8000-000000000001", "prewritten"],
    ["a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1", "ai"],
    ["d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4", "prewritten"],
    ["a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7", "prewritten"],
    ["b8b8b8b8-7777-4777-8777-b8b8b8b8b8b8", "ai"],
  ])("assigns %s to %s, like coach_ai_arm() in SQL", (id, arm) => {
    expect(assignAiArm(id)).toBe(arm);
  });
});
