import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FAILSAFE_FLAGS, LEGACY_FLAGS, PIVOT_FLAG_KEYS, resolveFlags, type PivotFlagKey, type PivotFlags } from "@/lib/domain/feature-flags";
import { createAdminClient } from "@/lib/supabase/admin";

const CACHE_TTL_MS = 30_000;
const FAILURE_RETRY_MS = 5_000;
const READ_TIMEOUT_MS = 3_000;

let cache: { flags: PivotFlags; expiresAt: number } | null = null;
let lastRead: PivotFlags | null = null;
let inFlight: Promise<PivotFlags> | null = null;

async function readFlagRows() {
  // app_feature_flags is service-role only and absent from the generated client types.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("app_feature_flags")
    .select("key, enabled")
    .in("key", [...PIVOT_FLAG_KEYS])
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
  if (error) throw new Error(`Feature flags could not be read: ${error.message}`);
  const rows: Partial<Record<PivotFlagKey, boolean>> = {};
  for (const row of (data ?? []) as Array<{ key: string; enabled: boolean }>) {
    if ((PIVOT_FLAG_KEYS as readonly string[]).includes(row.key)) rows[row.key as PivotFlagKey] = row.enabled;
  }
  return rows;
}

async function refreshFlags(): Promise<PivotFlags> {
  try {
    const flags = resolveFlags(await readFlagRows());
    lastRead = flags;
    cache = { flags, expiresAt: Date.now() + CACHE_TTL_MS };
    return flags;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      scope: "feature_flags",
      message: error instanceof Error ? error.message : String(error),
    }));
    // Hold the answer briefly so an outage costs one slow read per interval,
    // not one per request.
    const flags = lastRead ?? FAILSAFE_FLAGS;
    cache = { flags, expiresAt: Date.now() + FAILURE_RETRY_MS };
    return flags;
  }
}

/**
 * The Pivot A flags for this environment, cached for 30 s per server instance.
 * Concurrent callers share one read. A failed read keeps the last value read;
 * with none, it serves FAILSAFE_FLAGS, so persona chat and autoposting stay off.
 */
export async function getFlags(): Promise<PivotFlags> {
  // Same test as src/proxy.ts: demo mode never has a database to read.
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return LEGACY_FLAGS;
  if (cache && Date.now() < cache.expiresAt) return cache.flags;
  inFlight ??= refreshFlags().finally(() => { inFlight = null; });
  return inFlight;
}

/** Test-only: forget everything read so far. */
export function resetFlagCacheForTests() {
  cache = null;
  lastRead = null;
  inFlight = null;
}
