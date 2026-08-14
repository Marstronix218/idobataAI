import { describe, expect, it } from "vitest";

import { AVATAR_PATHS } from "@/lib/domain/avatar-options";
import { profileSchema } from "@/lib/server/schemas";

describe("profileSchema avatarUrl", () => {
  it.each(AVATAR_PATHS)("accepts the local preset %s", (avatarUrl) => {
    expect(profileSchema.safeParse({ avatarUrl }).success).toBe(true);
  });

  it("accepts a blank avatar and an existing absolute URL", () => {
    expect(profileSchema.safeParse({ avatarUrl: null }).success).toBe(true);
    expect(profileSchema.safeParse({ avatarUrl: "https://example.com/avatar.png" }).success).toBe(true);
  });

  it("rejects unknown local paths and relative URLs", () => {
    expect(profileSchema.safeParse({ avatarUrl: "/avatars/unknown.png" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "avatars/acorn.png" }).success).toBe(false);
  });
});
