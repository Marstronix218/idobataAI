// Which plan a user is on, from their `entitlements` rows. Stripe (Phase 6) and
// the App Store write that table; this only reads it, so a purchase source can
// be added without touching the reaction engine or the splitter.

export type PlanTier = "free" | "trial" | "plus";

/** The columns of `public.entitlements` the plan depends on. */
export interface EntitlementRow {
  product: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface ResolvedPlan {
  tier: PlanTier;
  /** Character slugs whose pack the user owns (`pack:<slug>`, active), sorted. */
  packs: string[];
}

const PACK_PREFIX = "pack:";

/** Null means open-ended; an unreadable date counts as already past (fail closed). */
function isOpenOrFuture(value: string | null, now: Date): boolean {
  if (value === null) return true;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * plus: a `plus` row that is `active` and whose `current_period_end` is null
 * or in the future. trial: a `plus` row that is `trialing` and whose
 * `trial_ends_at` is null or in the future. Otherwise free. Plus wins over a
 * trial when both exist (for example from two purchase sources).
 */
export function resolvePlan(rows: readonly EntitlementRow[], now: Date): ResolvedPlan {
  let tier: PlanTier = "free";
  const packs = new Set<string>();
  for (const row of rows) {
    if (row.product === "plus") {
      if (row.status === "active" && isOpenOrFuture(row.current_period_end, now)) tier = "plus";
      else if (row.status === "trialing" && isOpenOrFuture(row.trial_ends_at, now) && tier === "free") tier = "trial";
    } else if (row.product.startsWith(PACK_PREFIX) && row.status === "active") {
      const slug = row.product.slice(PACK_PREFIX.length);
      if (slug) packs.add(slug);
    }
  }
  return { tier, packs: [...packs].sort() };
}

/** Plus and trial users are treated alike for AI caps and the splitter. */
export const isPaidTier = (tier: PlanTier) => tier !== "free";
