import { ApiError, authed, noContent, withApi } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Objects are stored under `<userId>/...`; completion media adds a `pending/`
// prefix. `list` does not recurse, so each prefix is enumerated explicitly.
const STORAGE_PREFIXES: Array<{ bucket: string; folders: (userId: string) => string[] }> = [
  { bucket: "avatars", folders: (userId) => [userId] },
  { bucket: "completion-post-media", folders: (userId) => [userId, `${userId}/pending`] },
];

async function purgeUserStorage(admin: AdminClient, userId: string) {
  for (const { bucket, folders } of STORAGE_PREFIXES) {
    for (const folder of folders(userId)) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      // A missing folder is the normal case for a user who never uploaded.
      if (error || !data?.length) continue;
      const paths = data.filter((object) => object.id).map((object) => `${folder}/${object.name}`);
      if (!paths.length) continue;
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      // Erasure is the whole point of this route, so a failure to remove media
      // must abort rather than proceed to delete the rows that identify it.
      if (removeError) throw new ApiError(502, "Stored media could not be removed. No account data was deleted.", "storage_purge_failed");
    }
  }
}

export async function DELETE(request: Request) {
  return withApi(async () => {
    const { user } = await authed(request);
    const billingConfigured = (process.env.BILLING_PROVIDER && process.env.BILLING_PROVIDER !== "none")
      || process.env.STRIPE_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET;
    if (billingConfigured) {
      throw new ApiError(409, "Account deletion is unavailable until the configured billing provider can confirm subscription cancellation.", "billing_cancellation_required");
    }
    const auditSalt = process.env.ACCOUNT_DELETION_AUDIT_SALT;
    if (!auditSalt && process.env.NODE_ENV === "production") {
      throw new ApiError(503, "Account deletion audit protection is not configured.", "deletion_not_configured");
    }
    const admin = createAdminClient();
    const { data: deletion, error: requestError } = await admin.from("account_deletion_requests")
      .insert({ user_id: user.id, status: "processing" } as never).select("id").single();
    if (requestError || !deletion) throw requestError ?? new Error("Could not record deletion request.");
    const deletionId = (deletion as { id: string }).id;
    const fingerprint = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user.id}:${auditSalt ?? deletionId}`));
    const userFingerprint = Array.from(new Uint8Array(fingerprint)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    // Storage must be purged before the auth user is deleted. Deleting the user
    // cascades away `social_posts`, and `image_paths` is the only record of
    // which objects exist -- so an object not removed here becomes an orphan no
    // cleanup job can ever identify. Avatars are worse: that bucket is public,
    // so a deleted user's photo would stay fetchable at a stable URL forever.
    await purgeUserStorage(admin, user.id);

    const { error: anonymizationError } = await admin.from("account_deletion_requests")
      .update({ user_id: null, user_fingerprint: userFingerprint, status: "auth_delete_pending" } as never).eq("id", deletionId);
    if (anonymizationError) throw anonymizationError;
    const { error } = await admin.auth.admin.deleteUser(user.id, false);
    if (error) {
      await admin.from("account_deletion_requests").update({ status: "failed", last_error: error.message } as never).eq("id", deletionId);
      throw error;
    }
    const { error: finalizationError } = await admin.from("account_deletion_requests").update({ user_id: null, user_fingerprint: userFingerprint, status: "completed", completed_at: new Date().toISOString() } as never).eq("id", deletionId);
    if (finalizationError) console.error("Account deletion completed, but its pseudonymous audit status needs reconciliation.", finalizationError);
    return noContent();
  });
}
