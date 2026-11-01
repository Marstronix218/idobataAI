// Shared by the end-to-end global setup (main process) and the flow test
// (worker): which local Supabase stack to use, and how to set the Pivot A flags
// on it. Only relative imports here, so the global setup loads it without the
// `@/` alias.

import { createClient } from "@supabase/supabase-js";

export interface LocalSupabase {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    localSupabase: LocalSupabase;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Throws unless `url` points at localhost or 127.0.0.1: these tests create users and change flags. */
export function assertLocalSupabaseUrl(url: string) {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`test:e2e: "${url}" is not a valid Supabase URL.`);
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`test:e2e: refusing to run against ${hostname}. The end-to-end tests create users and change feature flags, so they only run against a local Supabase stack (localhost or 127.0.0.1).`);
  }
}

export function createServiceClient(stack: LocalSupabase) {
  return createClient(stack.url, stack.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export type ServiceClient = ReturnType<typeof createServiceClient>;

export const E2E_FLAG_KEYS = ["pivot_a.enabled", "beta_full_access.enabled"] as const;
export type E2eFlagKey = (typeof E2E_FLAG_KEYS)[number];

/** Upserts app_feature_flags rows, as `npm run flags -- set` does. */
export async function setFlags(admin: ServiceClient, flags: Partial<Record<E2eFlagKey, boolean>>) {
  const rows = Object.entries(flags).map(([key, enabled]) => ({ key, enabled }));
  if (rows.length === 0) return;
  const { error } = await admin.from("app_feature_flags").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`test:e2e: could not set feature flags: ${error.message}`);
}
