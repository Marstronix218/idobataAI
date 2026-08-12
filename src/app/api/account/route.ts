import { ApiError, authed, noContent, withApi } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";

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
