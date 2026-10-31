// Age from a date of birth, for the Pivot A age gate (SPEC "Adults only").
// Pure calendar arithmetic on year/month/day: no Date objects for the birth
// date, so no time zone can shift it by a day.
//
// Leap-day convention: someone born on 29 February has their birthday on
// 1 March in a non-leap year, so they turn 18 on 1 March, not 28 February.
// This is the later (stricter) of the two common readings, which suits a gate
// that must not let anyone in early. It falls out of comparing (month, day)
// pairs: 28 Feb sorts before 29 Feb, and 1 Mar after it.

import { resolveTimeZone } from "@/lib/domain/local-day";

export const ADULT_AGE = 18;
/** Older than this is treated as a typo, not a person. */
export const MAX_PLAUSIBLE_AGE = 120;

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A strict `YYYY-MM-DD` that names a real calendar date, or null. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Negative when `a` is earlier than `b`. */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Whole years from `dateOfBirth` to `today`; the birthday itself counts. */
export function ageOn(dateOfBirth: CalendarDate, today: CalendarDate) {
  const birthdayPassed = today.month > dateOfBirth.month
    || (today.month === dateOfBirth.month && today.day >= dateOfBirth.day);
  return today.year - dateOfBirth.year - (birthdayPassed ? 0 : 1);
}

export function isAdult(dateOfBirth: CalendarDate, today: CalendarDate) {
  return ageOn(dateOfBirth, today) >= ADULT_AGE;
}

/**
 * Today's date in `timeZone` (an IANA name). A missing or unknown zone means
 * UTC, as everywhere else in Pivot A.
 */
export function localToday(timeZone?: string | null, now: Date = new Date()): CalendarDate {
  const parts: Record<string, number> = {};
  const format = new Intl.DateTimeFormat("en-US", { timeZone: resolveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" });
  for (const part of format.formatToParts(now)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * The zone where the date changes last (UTC-12). The age gate decides "today"
 * here, so a birthday counts once it has arrived everywhere: nobody passes
 * early by claiming a zone further east. (IANA "Etc/GMT+12" is UTC-12.)
 */
export const EARLIEST_TIME_ZONE = "Etc/GMT+12";

/** Today's date in EARLIEST_TIME_ZONE: the earliest calendar date anywhere on Earth. */
export function earliestToday(now: Date = new Date()): CalendarDate {
  return localToday(EARLIEST_TIME_ZONE, now);
}

export type DateOfBirthCheck =
  | { ok: true; age: number; adult: boolean }
  | { ok: false; reason: "malformed" | "future" | "implausible" };

/**
 * Checks a typed date of birth against `today`: it must be a real date, not in
 * the future, and no more than MAX_PLAUSIBLE_AGE years ago.
 */
export function checkDateOfBirth(value: string, today: CalendarDate): DateOfBirthCheck {
  const dateOfBirth = parseCalendarDate(value);
  if (!dateOfBirth) return { ok: false, reason: "malformed" };
  if (compareCalendarDates(dateOfBirth, today) > 0) return { ok: false, reason: "future" };
  const age = ageOn(dateOfBirth, today);
  if (age > MAX_PLAUSIBLE_AGE) return { ok: false, reason: "implausible" };
  return { ok: true, age, adult: age >= ADULT_AGE };
}

/** `YYYY-MM-DD`, e.g. for an `<input type="date">` bound. */
export function formatCalendarDate(date: CalendarDate) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
