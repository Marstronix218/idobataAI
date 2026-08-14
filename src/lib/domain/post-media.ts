export const POST_MEDIA_MAX_FILES = 4;
export const POST_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const POST_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PostMediaType = typeof POST_MEDIA_TYPES[number];

export function isPostMediaType(value: string): value is PostMediaType {
  return POST_MEDIA_TYPES.includes(value as PostMediaType);
}
