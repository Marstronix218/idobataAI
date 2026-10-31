// Local calendar days for a user's IANA time zone. Caps, streaks, the daily AI
// reminder and ai_usage_daily.date all work in the user's local day, so they
// reset at local midnight, including on 23- and 25-hour DST days. A null or
// unknown zone means UTC, matching public.coach_local_date().

export const DEFAULT_TIME_ZONE = "UTC";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** `timeZone` when the runtime knows it, otherwise UTC. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const values: Record<string, number> = {};
  for (const part of formatter(resolveTimeZone(timeZone)).formatToParts(at)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // Some engines still print midnight as 24 under h23.
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

function parseDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}".`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** The local calendar date (YYYY-MM-DD) at `at` in `timeZone`. */
export function localDate(at: Date, timeZone: string | null | undefined): string {
  const parts = localParts(at, resolveTimeZone(timeZone));
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The local hour, 0-23. */
export function localHour(at: Date, timeZone: string | null | undefined): number {
  return localParts(at, resolveTimeZone(timeZone)).hour;
}

/** morning 05-11, afternoon 12-16, evening 17-20, night 21-04 (local). */
export function timeOfDay(at: Date, timeZone: string | null | undefined): TimeOfDay {
  const hour = localHour(at, timeZone);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** Calendar arithmetic on YYYY-MM-DD, independent of any zone. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parseDate(from);
  const [toYear, toMonth, toDay] = parseDate(to);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / DAY_MS);
}

/** The `days` dates ending at `today`, oldest first: [today-(days-1), ..., today]. */
export function localDateRange(today: string, days: number): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, index) => addDays(today, index - (days - 1)));
}

/** The zone's UTC offset at `at`, in milliseconds (local minus UTC), to the second. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = localParts(at, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The first instant of local `date` in `timeZone`. Usually local midnight; on a
 * day whose midnight a DST jump skips, the moment the day actually begins.
 */
export function startOfLocalDay(date: string, timeZone: string | null | undefined): Date {
  const zone = resolveTimeZone(timeZone);
  const [year, month, day] = parseDate(date);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  let guess = midnightAsUtc - offsetMs(new Date(midnightAsUtc), zone);
  guess = midnightAsUtc - offsetMs(new Date(guess), zone);
  if (localDate(new Date(guess), zone) === date) return new Date(guess);

  // Midnight was skipped, so `guess` sits on the previous day: search forward
  // (at most a few hours) for the first second that belongs to `date`.
  let before = guess;
  let after = guess + 4 * 3_600_000;
  while (after - before > 1000) {
    const middle = before + Math.floor((after - before) / 2000) * 1000;
    if (localDate(new Date(middle), zone) < date) before = middle;
    else after = middle;
  }
  return new Date(after);
}

/** [start, end) of local `date`; 23 or 25 hours long on DST change days. */
export function localDayBounds(date: string, timeZone: string | null | undefined): { start: Date; end: Date } {
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}
