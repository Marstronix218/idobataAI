import { describe, expect, it } from "vitest";
import { assignAiArm } from "@/lib/domain/ai-arm";
import { resolvePlan, type EntitlementRow } from "@/lib/domain/plan";

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
});
