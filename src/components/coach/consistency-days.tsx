"use client";

import { createContext } from "react";

/**
 * Pivot A shows consistency days in place of a streak: local days with at least
 * one finished task. The count never goes down, and a count of zero (or one
 * that failed to load) shows nothing at all, so there is never a zero, a broken
 * streak or a loss to look at.
 */

// TODO(founder): copy. Read after the count, e.g. "5 days with at least one finished task".
export const CONSISTENCY_DAYS_DESCRIPTION = "with at least one finished task";

/** True when there is a positive count to show. */
export function hasConsistencyDays(days: number | null | undefined): days is number {
  return typeof days === "number" && days > 0;
}

/** "1 day" or "N days". */
export function consistencyDaysLabel(days: number) {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Set by the app shell under Pivot A only, so the momentum rail (rendered by
 * each page) can show the count the layout read on the server. `null` means
 * Pivot A is off and the legacy streak shows.
 */
export const ConsistencyDaysContext = createContext<{ days: number | null } | null>(null);
