"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { FormEvent, useState } from "react";
import { errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";

type RecoveryMode = "forgot-password" | "resend-confirmation" | "update-password";

const genericMessage = {
  "forgot-password": "If an account exists for that email, we sent a password reset link.",
  "resend-confirmation": "If an unconfirmed account exists for that email, we sent a new confirmation link.",
} as const;
const genericDeliveryError = "We couldn’t send an email right now. Wait a moment and try again.";

export function RecoveryForm({ mode, defaultEmail = "" }: { mode: RecoveryMode; defaultEmail?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const updatesPassword = mode === "update-password";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    if (updatesPassword) {
      const password = String(form.get("password"));
      const confirmation = String(form.get("password-confirmation"));
      if (password !== confirmation) {
        setStatus("Passwords do not match.");
        return;
      }
    }

    if (isPreviewMode) {
      setStatus(updatesPassword
        ? "Preview mode: your password change was simulated."
        : genericMessage[mode]);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const supabase = createClient();
      if (updatesPassword) {
        const password = String(form.get("password"));
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        router.replace("/feed");
        router.refresh();
        return;
      }

      const email = String(form.get("email"));
      const origin = window.location.origin;
      if (mode === "forgot-password") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=/update-password`,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
        });
        if (error) throw error;
      }
      setStatus(genericMessage[mode]);
    } catch (error) {
      setStatus(updatesPassword ? errorMessage(error) : genericDeliveryError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {isPreviewMode && (
        <div role="note" className="rounded-2xl bg-sun-soft p-4 text-sm leading-6">
          <strong>Preview mode.</strong> Authentication is simulated and no email will be sent.
        </div>
      )}
      {updatesPassword ? (
        <>
          <div>
            <label className="field-label" htmlFor="password">New password</label>
            <input className="field" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div>
            <label className="field-label" htmlFor="password-confirmation">Confirm new password</label>
            <input className="field" id="password-confirmation" name="password-confirmation" type="password" autoComplete="new-password" minLength={8} required />
          </div>
        </>
      ) : (
        <div>
          <label className="field-label" htmlFor="email">Email address</label>
          <input className="field" id="email" name="email" type="email" autoComplete="email" placeholder="mina@example.com" defaultValue={defaultEmail} required />
        </div>
      )}
      <button className="btn btn-primary w-full py-3" type="submit" disabled={busy}>
        {busy ? "Sending…" : updatesPassword ? "Save new password" : mode === "forgot-password" ? "Send reset link" : "Resend confirmation"}
        <ArrowRight size={17} />
      </button>
      <p aria-live="polite" className="min-h-5 text-center text-sm font-bold text-muted">{status}</p>
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-bold text-community hover:underline">Back to login</Link>
      </p>
    </form>
  );
}
