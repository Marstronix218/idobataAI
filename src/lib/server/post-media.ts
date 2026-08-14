import "server-only";

import {
  POST_MEDIA_MAX_BYTES,
  POST_MEDIA_MAX_FILES,
  POST_MEDIA_TYPES,
  isPostMediaType,
  type PostMediaType,
} from "@/lib/domain/post-media";
import { ApiError } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const POST_MEDIA_BUCKET = "completion-post-media";
export const POST_MEDIA_SIGNED_URL_TTL_SECONDS = 5 * 60;
export { POST_MEDIA_MAX_BYTES, POST_MEDIA_MAX_FILES, POST_MEDIA_TYPES, isPostMediaType };

const extensionByType: Record<PostMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function postMediaExtension(type: PostMediaType) {
  return extensionByType[type];
}

export function assertOwnedPostMediaPath(path: string, userId: string) {
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedUserId}/pending/[0-9a-f-]{36}\\.(?:jpg|png|webp)$`, "i");
  if (!pattern.test(path)) throw new ApiError(422, "An image path is invalid.", "invalid_image_path");
}

function matchesSignature(bytes: Uint8Array, extension: string) {
  if (extension === "jpg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (extension === "webp") return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function validateStoredPostMedia(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  paths: string[],
) {
  if (paths.length > POST_MEDIA_MAX_FILES) throw new ApiError(422, `Add up to ${POST_MEDIA_MAX_FILES} images.`, "too_many_images");
  if (new Set(paths).size !== paths.length) throw new ApiError(422, "Each image can be attached only once.", "duplicate_image_path");
  for (const path of paths) {
    assertOwnedPostMediaPath(path, userId);
    const { data, error } = await admin.storage.from(POST_MEDIA_BUCKET).download(path);
    if (error || !data) throw new ApiError(422, "An uploaded image could not be verified.", "image_not_found");
    if (data.size <= 0 || data.size > POST_MEDIA_MAX_BYTES) throw new ApiError(422, "Each image must be 5MB or smaller.", "image_too_large");
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    const bytes = new Uint8Array(await data.slice(0, 16).arrayBuffer());
    if (!matchesSignature(bytes, extension)) {
      throw new ApiError(422, "Only valid JPEG, PNG, or WebP images can be posted.", "invalid_image_content");
    }
  }
}

export async function removePostMedia(admin: ReturnType<typeof createAdminClient>, paths: string[]) {
  if (!paths.length) return;
  const { error } = await admin.storage.from(POST_MEDIA_BUCKET).remove(paths);
  if (error) console.error("Unable to remove completion post media", error);
}

export async function signPostMediaByPath(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[],
) {
  if (!paths.length) return new Map<string, string>();
  const { data, error } = await admin.storage
    .from(POST_MEDIA_BUCKET)
    .createSignedUrls(paths, POST_MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("Unable to sign completion post media", error);
    return new Map<string, string>();
  }
  return new Map(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}
