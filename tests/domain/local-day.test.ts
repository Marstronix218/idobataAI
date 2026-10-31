import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  localDate,
  localDateRange,
  localDayBounds,
  localHour,
  resolveTimeZone,
  startOfLocalDay,
  timeOfDay,
} from "@/lib/domain/local-day";

describe("local dates", () => {
  it("treats a null or unknown zone as UTC", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(localDate(new Date("2026-10-31T23:30:00Z"), null)).toBe("2026-10-31");
  });

  it("gives the same instant different local dates across zones", () => {
    const instant = new Date("2026-10-31T23:30:00Z");

    expect(localDate(instant, "America/Los_Angeles")).toBe("2026-10-31");
    expect(localDate(instant, "Asia/Tokyo")).toBe("2026-11-01");
    expect(localDate(instant, "Pacific/Kiritimati")).toBe("2026-11-01");
    expect(localDate(instant, "Pacific/Pago_Pago")).toBe("2026-10-31");
  });

  it("rolls over at local midnight", () => {
    expect(localDate(new Date("2026-10-31T04:59:59Z"), "America/Chicago")).toBe("2026-10-30");
    expect(localDate(new Date("2026-10-31T05:00:00Z"), "America/Chicago")).toBe("2026-10-31");
  });

  it("does calendar arithmetic across months and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-10-25", "2026-10-31")).toBe(6);
    expect(daysBetween("2026-10-31", "2026-10-25")).toBe(-6);
    expect(localDateRange("2026-11-02", 7)).toEqual([
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
  });

  it("buckets the local time of day", () => {
    const zone = "America/New_York";
    expect(timeOfDay(new Date("2026-10-31T09:00:00Z"), zone)).toBe("morning"); // 05:00 EDT
    expect(timeOfDay(new Date("2026-10-31T16:00:00Z"), zone)).toBe("afternoon"); // 12:00
    expect(timeOfDay(new Date("2026-10-31T21:00:00Z"), zone)).toBe("evening"); // 17:00
    expect(timeOfDay(new Date("2026-11-01T01:00:00Z"), zone)).toBe("night"); // 21:00
    expect(timeOfDay(new Date("2026-10-31T08:59:00Z"), zone)).toBe("night"); // 04:59
    expect(localHour(new Date("2026-10-31T04:00:00Z"), zone)).toBe(0);
  });
});

describe("local day boundaries across DST", () => {
  it("makes the fall-back day 25 hours long (America/New_York, 2026-11-01)", () => {
    const { start, end } = localDayBounds("2026-11-01", "America/New_York");

    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // midnight EDT
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // midnight EST
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it("makes the spring-forward day 23 hours long (America/New_York, 2026-03-08)", () => {
    const { start, end } = localDayBounds("2026-03-08", "America/New_York");

    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it("starts a day whose midnight a DST jump skips at the jump (America/Santiago, 2026-09-06)", () => {
    // Chile moves clocks from 00:00 to 01:00 on the first Sunday of September.
    const start = startOfLocalDay("2026-09-06", "America/Santiago");

    expect(localDate(start, "America/Santiago")).toBe("2026-09-06");
    expect(localDate(new Date(start.getTime() - 1000), "America/Santiago")).toBe("2026-09-05");
    expect(localHour(start, "America/Santiago")).toBe(1);
  });

  it("agrees with localDate on both sides of each boundary", () => {
    for (const zone of ["UTC", "Asia/Kolkata", "Australia/Lord_Howe", "Europe/London", "America/St_Johns"]) {
      const { start, end } = localDayBounds("2026-10-31", zone);
      expect(localDate(start, zone)).toBe("2026-10-31");
      expect(localDate(new Date(start.getTime() - 1000), zone)).toBe("2026-10-30");
      expect(localDate(new Date(end.getTime() - 1000), zone)).toBe("2026-10-31");
      expect(localDate(end, zone)).toBe("2026-11-01");
    }
  });
});
