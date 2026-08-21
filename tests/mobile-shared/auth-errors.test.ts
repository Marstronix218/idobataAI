import { describe, expect, it } from "vitest";

import { guardAuthResult } from "../../apps/mobile/src/lib/auth/errors";

describe("mobile authentication error boundary", () => {
  it.each(["Keychain read failed", "Keychain write failed"])(
    "converts a thrown storage failure into a recoverable result: %s",
    async (message) => {
      const result = await guardAuthResult(async () => {
        throw new Error(message);
      });

      expect(result).toEqual({
        error: "Your secure session could not be updated. Check your device storage and try again.",
      });
    },
  );
});
