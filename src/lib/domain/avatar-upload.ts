export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const extensionByType: Record<(typeof AVATAR_ACCEPTED_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function avatarFileError(file: Pick<File, "size" | "type">) {
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type as (typeof AVATAR_ACCEPTED_TYPES)[number])) {
    return "Choose a JPG, PNG, or WebP image.";
  }
  if (file.size > AVATAR_MAX_BYTES) return "Choose an image smaller than 2 MB.";
  return null;
}

export function avatarObjectPath(userId: string, mimeType: (typeof AVATAR_ACCEPTED_TYPES)[number], id: string) {
  return `${userId}/${id}.${extensionByType[mimeType]}`;
}

export function storedAvatarObjectPath(avatarUrl: string | null, userId: string) {
  if (!avatarUrl) return null;
  try {
    const marker = "/storage/v1/object/public/avatars/";
    const path = decodeURIComponent(new URL(avatarUrl).pathname.split(marker)[1] ?? "");
    return path.startsWith(`${userId}/`) ? path : null;
  } catch {
    return null;
  }
}
