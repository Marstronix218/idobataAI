import { defineConfig } from "vitest/config";

// `npm run test:e2e` (PLAN D8): the onboarding flow against the local Supabase
// stack, calling the real route handlers with no database mocks. `npm test`
// (vitest.config.mts) excludes tests/e2e.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: "e2e",
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["./tests/e2e/global-setup.ts"],
    setupFiles: ["./tests/e2e/setup.ts"],
    // One file at a time: the scenarios share the stack's feature flags.
    fileParallelism: false,
    // Every step is a real HTTP round trip to the local stack; the global setup
    // may also download the Supabase CLI through npx.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
