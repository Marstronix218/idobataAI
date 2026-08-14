import { describe, expect, it } from "vitest";

import { AVATAR_MAX_BYTES, avatarFileError, avatarObjectPath, storedAvatarObjectPath } from "@/lib/domain/avatar-upload";

describe("avatar upload helpers", () => {
  it("accepts supported images at the size limit", () => {
    expect(avatarFileError({ type: "image/png", size: AVATAR_MAX_BYTES })).toBeNull();
  });

  it("rejects unsupported or oversized files", () => {
    expect(avatarFileError({ type: "image/svg+xml", size: 100 })).toMatch(/JPG, PNG, or WebP/);
    expect(avatarFileError({ type: "image/jpeg", size: AVATAR_MAX_BYTES + 1 })).toMatch(/smaller than 2 MB/);
  });

  it("builds immutable user-owned paths and recognizes owned public URLs", () => {
    expect(avatarObjectPath("user-1", "image/webp", "asset-1")).toBe("user-1/asset-1.webp");
    expect(storedAvatarObjectPath("https://demo.supabase.co/storage/v1/object/public/avatars/user-1/asset-1.webp", "user-1")).toBe("user-1/asset-1.webp");
    expect(storedAvatarObjectPath("https://demo.supabase.co/storage/v1/object/public/avatars/user-2/asset-1.webp", "user-1")).toBeNull();
  });
});
