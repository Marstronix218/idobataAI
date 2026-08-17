import { describe, expect, it } from "vitest";

import { AVATAR_PATHS } from "@/lib/domain/avatar-options";
import { profileSchema } from "@/lib/server/schemas";

describe("profileSchema avatarUrl", () => {
  it.each(AVATAR_PATHS)("accepts the local preset %s", (avatarUrl) => {
    expect(profileSchema.safeParse({ avatarUrl }).success).toBe(true);
  });

  it("accepts a blank avatar", () => {
    expect(profileSchema.safeParse({ avatarUrl: null }).success).toBe(true);
  });

  // An arbitrary remote URL is rendered as an <img> for every viewer, handing
  // its host each viewer's IP, User-Agent and Referer.
  it("rejects avatars hosted anywhere but this project's own storage", () => {
    expect(profileSchema.safeParse({ avatarUrl: "https://example.com/avatar.png" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "data:text/html,<script></script>" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "http://169.254.169.254/latest/meta-data" }).success).toBe(false);
  });

  it("rejects unknown local paths and relative URLs", () => {
    expect(profileSchema.safeParse({ avatarUrl: "/avatars/unknown.png" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "avatars/acorn.png" }).success).toBe(false);
  });

  it("accepts social profile fields and enforces their limits", () => {
    expect(profileSchema.safeParse({ displayName: "Mina Mori", bio: "Quiet progress.", profileVisibility: "public" }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: "x".repeat(51) }).success).toBe(false);
    expect(profileSchema.safeParse({ bio: "x".repeat(161) }).success).toBe(false);
  });
});
