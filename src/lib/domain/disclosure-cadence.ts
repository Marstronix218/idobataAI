// When a reaction carries the AI reminder (SPEC "Always disclose", PLAN D11):
// on the first reaction shown in each local day, and, when
// AI_DISCLOSURE_MAX_GAP_HOURS is set, again once that many hours have passed
// since it was last shown.
//
// New York requires a daily or 3-hourly reminder; set
// AI_DISCLOSURE_MAX_GAP_HOURS=3 if counsel reads it as 3-hourly. The open
// founder item is next to where the reaction engine applies this.

import { localDate } from "./local-day";

type Env = Readonly<Record<string, string | undefined>>;

/** AI_DISCLOSURE_MAX_GAP_HOURS as a positive number of hours, or null when unset or invalid. */
export function readDisclosureMaxGapHours(env: Env = process.env): number | null {
  const raw = env.AI_DISCLOSURE_MAX_GAP_HOURS?.trim();
  if (!raw) return null;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

export interface DisclosureInput {
  /** When a reaction last carried the reminder; null if never. */
  lastShownAt: Date | null;
  now: Date;
  timeZone: string | null;
  maxGapHours?: number | null;
}

export function shouldShowDisclosure({ lastShownAt, now, timeZone, maxGapHours = null }: DisclosureInput): boolean {
  if (!lastShownAt || Number.isNaN(lastShownAt.getTime())) return true;
  if (localDate(lastShownAt, timeZone) !== localDate(now, timeZone)) return true;
  return maxGapHours !== null && now.getTime() - lastShownAt.getTime() >= maxGapHours * 3_600_000;
}
