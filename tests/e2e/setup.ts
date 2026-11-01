// Per-worker setup for `npm run test:e2e`: point the route handlers at the
// local stack found by global-setup.ts, and pin the environment the flow
// relies on, whatever the developer's shell or .env.local says.

import { inject, vi } from "vitest";

// Route handlers read flags through the server-only `@/lib/flags`; the marker
// throws outside a React Server Components build (same stub as tests/setup.ts).
vi.mock("server-only", () => ({}));

const stack = inject("localSupabase");

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: stack.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
  // The development age verifier (src/lib/age/verifier.ts).
  ALLOW_SELF_ATTESTED_AGE: "true",
  APP_ENV: "test",
  // No model calls: reactions are prewritten and the distress check is keyword-only.
  AI_ENABLED: "false",
});

for (const key of [
  "ANTHROPIC_API_KEY",
  // Demo mode makes getFlags() return the legacy flags without reading the database.
  "NEXT_PUBLIC_ENABLE_DEMO_MODE",
  "AGE_VERIFIER",
  "VERCEL",
  "VERCEL_ENV",
  "APP_URL",
  "CLIENT_IP_HEADER",
  "AI_DISCLOSURE_MAX_GAP_HOURS",
]) {
  delete process.env[key];
}
