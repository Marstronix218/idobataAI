import { describe, expect, it } from "vitest";
import {
  ADULT_AGE,
  MAX_PLAUSIBLE_AGE,
  EARLIEST_TIME_ZONE,
  ageOn,
  checkDateOfBirth,
  earliestToday,
  compareCalendarDates,
  formatCalendarDate,
  isAdult,
  localToday,
  parseCalendarDate,
  type CalendarDate,
} from "@/lib/domain/age";

const date = (value: string): CalendarDate => {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`bad fixture ${value}`);
  return parsed;
};

describe("parseCalendarDate", () => {
  it.each([
    ["2000-01-31", { year: 2000, month: 1, day: 31 }],
    ["2004-02-29", { year: 2004, month: 2, day: 29 }],
    ["2000-02-29", { year: 2000, month: 2, day: 29 }],
    ["1999-12-31", { year: 1999, month: 12, day: 31 }],
  ])("accepts %s", (value, expected) => {
    expect(parseCalendarDate(value)).toEqual(expected);
  });

  it.each([
    "2001-02-29", // not a leap year
    "1900-02-29", // century, not a leap year
    "2000-04-31",
    "2000-13-01",
    "2000-00-10",
    "2000-01-00",
    "2000-1-01",
    "2000-01-1",
    "20000-01-01",
    "0000-01-01",
    "2000/01/01",
    "01-01-2000",
    " 2000-01-01",
    "2000-01-01T00:00:00Z",
    "",
    "not a date",
  ])("rejects %j", (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts the birthday itself", () => {
    expect(ageOn(date("2008-10-31"), date("2026-10-31"))).toBe(18);
    expect(ageOn(date("2008-10-31"), date("2026-10-30"))).toBe(17);
    expect(ageOn(date("2008-11-01"), date("2026-10-31"))).toBe(17);
    expect(ageOn(date("2008-10-30"), date("2026-10-31"))).toBe(18);
  });

  it("handles the year boundary", () => {
    expect(ageOn(date("2008-12-31"), date("2026-12-31"))).toBe(18);
    expect(ageOn(date("2008-12-31"), date("2027-01-01"))).toBe(18);
    expect(ageOn(date("2009-01-01"), date("2026-12-31"))).toBe(17);
  });

  // Convention: a 29 February birthday falls on 1 March in non-leap years.
  it("turns a leap-day baby 18 on 1 March in a non-leap year, not on 28 February", () => {
    const leapDay = date("2008-02-29");
    expect(ageOn(leapDay, date("2026-02-28"))).toBe(17);
    expect(isAdult(leapDay, date("2026-02-28"))).toBe(false);
    expect(ageOn(leapDay, date("2026-03-01"))).toBe(18);
    expect(isAdult(leapDay, date("2026-03-01"))).toBe(true);
  });

  it("turns a leap-day baby a year older on 29 February in a leap year", () => {
    const leapDay = date("2012-02-29");
    expect(ageOn(leapDay, date("2032-02-28"))).toBe(19);
    expect(ageOn(leapDay, date("2032-02-29"))).toBe(20);
  });

  it("is not fooled by a 28 February or 1 March birthday near a leap day", () => {
    expect(ageOn(date("2008-02-28"), date("2026-02-28"))).toBe(18);
    expect(ageOn(date("2008-03-01"), date("2026-02-28"))).toBe(17);
    expect(ageOn(date("2008-03-01"), date("2026-03-01"))).toBe(18);
  });
});

describe("isAdult", () => {
  it(`is ${ADULT_AGE} and over`, () => {
    expect(isAdult(date("2008-10-31"), date("2026-10-31"))).toBe(true);
    expect(isAdult(date("2008-11-01"), date("2026-10-31"))).toBe(false);
    expect(isAdult(date("1950-06-15"), date("2026-10-31"))).toBe(true);
  });
});

describe("checkDateOfBirth", () => {
  const today = date("2026-10-31");

  it("passes an adult and flags a minor", () => {
    expect(checkDateOfBirth("2008-10-31", today)).toEqual({ ok: true, age: 18, adult: true });
    expect(checkDateOfBirth("2008-11-01", today)).toEqual({ ok: true, age: 17, adult: false });
    // Born today: a real date, and a minor.
    expect(checkDateOfBirth("2026-10-31", today)).toEqual({ ok: true, age: 0, adult: false });
  });

  it("rejects a future date", () => {
    expect(checkDateOfBirth("2026-11-01", today)).toEqual({ ok: false, reason: "future" });
    expect(checkDateOfBirth("2099-01-01", today)).toEqual({ ok: false, reason: "future" });
  });

  it(`rejects an age over ${MAX_PLAUSIBLE_AGE}`, () => {
    expect(checkDateOfBirth("1905-11-01", today)).toEqual({ ok: true, age: 120, adult: true });
    expect(checkDateOfBirth("1905-10-31", today)).toEqual({ ok: false, reason: "implausible" });
    expect(checkDateOfBirth("1800-01-01", today)).toEqual({ ok: false, reason: "implausible" });
  });

  it("rejects a malformed or impossible date", () => {
    expect(checkDateOfBirth("2007-02-29", today)).toEqual({ ok: false, reason: "malformed" });
    expect(checkDateOfBirth("31/10/2000", today)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("localToday", () => {
  // 2026-10-31T02:30Z: still 30 October in New York, already 31 October in Tokyo.
  const instant = new Date("2026-10-31T02:30:00Z");

  it("uses the given IANA zone", () => {
    expect(localToday("America/New_York", instant)).toEqual({ year: 2026, month: 10, day: 30 });
    expect(localToday("Asia/Tokyo", instant)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it("falls back to UTC for a missing or invalid zone", () => {
    expect(localToday(undefined, instant)).toEqual({ year: 2026, month: 10, day: 31 });
    expect(localToday(null, instant)).toEqual({ year: 2026, month: 10, day: 31 });
    expect(localToday("Not/AZone", instant)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it("decides an 18th birthday at local midnight", () => {
    const dob = date("2008-10-31");
    expect(isAdult(dob, localToday("America/New_York", instant))).toBe(false);
    expect(isAdult(dob, localToday("Asia/Tokyo", instant))).toBe(true);
  });
});

describe("earliestToday", () => {
  it("is the date in UTC-12, the last place a day begins", () => {
    expect(EARLIEST_TIME_ZONE).toBe("Etc/GMT+12");
    // 11:59 UTC is still the previous day in UTC-12; 12:00 UTC is the new day there.
    expect(earliestToday(new Date("2026-10-31T11:59:59Z"))).toEqual({ year: 2026, month: 10, day: 30 });
    expect(earliestToday(new Date("2026-10-31T12:00:00Z"))).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it("is never later than today in any zone", () => {
    const instant = new Date("2026-10-31T02:30:00Z");
    for (const zone of ["Pacific/Kiritimati", "Asia/Tokyo", "UTC", "America/New_York", "Pacific/Pago_Pago"]) {
      expect(compareCalendarDates(earliestToday(instant), localToday(zone, instant))).toBeLessThanOrEqual(0);
    }
  });
});

describe("helpers", () => {
  it("orders and formats calendar dates", () => {
    expect(compareCalendarDates(date("2000-01-02"), date("2000-01-01"))).toBeGreaterThan(0);
    expect(compareCalendarDates(date("2000-01-01"), date("2000-01-01"))).toBe(0);
    expect(compareCalendarDates(date("1999-12-31"), date("2000-01-01"))).toBeLessThan(0);
    expect(formatCalendarDate({ year: 987, month: 3, day: 4 })).toBe("0987-03-04");
  });
});
