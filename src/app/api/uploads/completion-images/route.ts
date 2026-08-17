import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  POST_MEDIA_BUCKET,
  POST_MEDIA_MAX_BYTES,
  POST_MEDIA_MAX_FILES,
  POST_MEDIA_TYPES,
  assertOwnedPostMediaPath,
  isPostMediaType,
  postMediaExtension,
  removePostMedia,
} from "@/lib/server/post-media";
import { ApiError, assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const uploadRequestSchema = z.object({
  files: z.array(z.object({
    type: z.enum(POST_MEDIA_TYPES),
    size: z.number().int().positive().max(POST_MEDIA_MAX_BYTES),
  }).strict()).min(1).max(POST_MEDIA_MAX_FILES),
}).strict();

const cleanupRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(300)).min(1).max(POST_MEDIA_MAX_FILES),
}).strict();

export async function POST(request: Request) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    // Each ticket is a signed URL for a 5MB object. Unlimited tickets meant
    // unbounded storage cost from uploads that never reach a published post.
    await enforceRateLimit(supabase, "upload:ticket", 40, 3600);
    const input = await parseJson(request, uploadRequestSchema);
    const admin = createAdminClient();
    const tickets = [];

    for (const file of input.files) {
      if (!isPostMediaType(file.type)) throw new ApiError(422, "Choose JPEG, PNG, or WebP images.", "invalid_image_type");
      const path = `${user.id}/pending/${randomUUID()}.${postMediaExtension(file.type)}`;
      const ticket = assertDatabase(await admin.storage.from(POST_MEDIA_BUCKET).createSignedUploadUrl(path));
      if (!ticket) throw new ApiError(500, "Could not create an image upload.", "upload_ticket_failed");
      tickets.push({ path, token: ticket.token });
    }

    return ok(tickets, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return withApi(async () => {
    const { user } = await authed(request);
    const input = await parseJson(request, cleanupRequestSchema);
    input.paths.forEach((path) => assertOwnedPostMediaPath(path, user.id));
    await removePostMedia(createAdminClient(), input.paths);
    return noContent();
  });
}
