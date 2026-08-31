import { COMPLETION_COMMENT_MAX_CHARACTERS } from "@idobata/contracts";
import { describe, expect, it } from "vitest";

import { publishSchema } from "@/lib/server/schemas";

describe("completion post schema", () => {
  const base = { visibility: "private" as const };

  it("accepts comments through the shared 300-character limit", () => {
    expect(COMPLETION_COMMENT_MAX_CHARACTERS).toBe(300);
    expect(publishSchema.safeParse({ ...base, message: "x".repeat(300) }).success).toBe(true);
  });

  it("rejects comments longer than the shared limit", () => {
    expect(publishSchema.safeParse({ ...base, message: "x".repeat(301) }).success).toBe(false);
  });

  it("accepts explicit completion-tag visibility choices", () => {
    expect(publishSchema.safeParse({ ...base, showCategoryTag: false, showStreakTag: false }).success).toBe(true);
  });
});
