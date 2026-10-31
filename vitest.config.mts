import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    // Every test is well under a second alone; CI runners and loaded machines run them 10x slower, and the 5s default then times out unrelated tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
