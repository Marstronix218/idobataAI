import "server-only";

import { resolvePlan, withBetaFullAccess, type EntitlementRow, type ResolvedPlan } from "@/lib/domain/plan";
import { getFlags } from "@/lib/flags";

/**
 * The plan a user gets: the one place tiers are decided for users. Their
 * entitlements (resolvePlan), raised to Plus while the free beta's full access
 * is on (`beta_full_access.enabled` with Pivot A on). Callers pass the rows
 * they already loaded. The reaction engine, the splitter and the story use
 * it; the ai_arm experiment is separate (the prewritten arm stays prewritten),
 * and the SQL reports keep reading tiers from entitlements.
 */
export async function resolveEffectivePlan(rows: readonly EntitlementRow[], now: Date): Promise<ResolvedPlan> {
  return withBetaFullAccess(resolvePlan(rows, now), await getFlags());
}
