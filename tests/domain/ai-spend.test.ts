import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_ALERT_PER_PAYING_USER_USD,
  isSpendLimitReached,
  isSpendNearLimit,
  readCostAlertPerPayingUserUsd,
  readDailySpendLimitUsd,
  utcDate,
} from "@/lib/domain/ai-spend";

describe("readDailySpendLimitUsd", () => {
  it("is null (no breaker) when unset, empty or not a non-negative number", () => {
    for (const value of [undefined, "", "  ", "abc", "-1", "Infinity", "NaN"]) {
      expect(readDailySpendLimitUsd({ AI_DAILY_SPEND_LIMIT_USD: value }), String(value)).toBeNull();
    }
  });

  it("reads dollars, including 0 (AI off)", () => {
    expect(readDailySpendLimitUsd({ AI_DAILY_SPEND_LIMIT_USD: "12.5" })).toBe(12.5);
    expect(readDailySpendLimitUsd({ AI_DAILY_SPEND_LIMIT_USD: "0" })).toBe(0);
  });
});

describe("readCostAlertPerPayingUserUsd", () => {
  it("defaults to $0.66, 15% of $4.42 net", () => {
    expect(DEFAULT_COST_ALERT_PER_PAYING_USER_USD).toBe(0.66);
    expect(readCostAlertPerPayingUserUsd({})).toBe(0.66);
    expect(readCostAlertPerPayingUserUsd({ AI_COST_ALERT_PER_PAYING_USER_USD: "nope" })).toBe(0.66);
    expect(readCostAlertPerPayingUserUsd({ AI_COST_ALERT_PER_PAYING_USER_USD: "-2" })).toBe(0.66);
  });

  it("reads a configured threshold", () => {
    expect(readCostAlertPerPayingUserUsd({ AI_COST_ALERT_PER_PAYING_USER_USD: "0.5" })).toBe(0.5);
  });
});

describe("spend thresholds", () => {
  it("reaches the limit at exactly the limit, never without one", () => {
    expect(isSpendLimitReached(4.99, 5)).toBe(false);
    expect(isSpendLimitReached(5, 5)).toBe(true);
    expect(isSpendLimitReached(7, 5)).toBe(true);
    expect(isSpendLimitReached(0, 0)).toBe(true);
    expect(isSpendLimitReached(1_000, null)).toBe(false);
  });

  it("is near the limit from 80% of it", () => {
    expect(isSpendNearLimit(7.99, 10)).toBe(false);
    expect(isSpendNearLimit(8, 10)).toBe(true);
    expect(isSpendNearLimit(12, 10)).toBe(true);
    expect(isSpendNearLimit(1_000, null)).toBe(false);
  });
});

describe("utcDate", () => {
  it("is the UTC calendar date", () => {
    expect(utcDate(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-31");
    expect(utcDate(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
  });
});
