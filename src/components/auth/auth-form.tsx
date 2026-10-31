"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { AGE_CHECK_ERROR_CODES } from "@idobata/contracts";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, isPreviewMode } from "@/lib/client/api";
import { isExistingAccountError, isExistingAccountSignUp } from "@/lib/auth/existing-account";
import { safeDestination } from "@/lib/auth/safe-destination";
import { detectTimeZone } from "@/lib/domain/time-zones";

type AgeCheck = { kind: "token"; token: string } | { kind: "legacy" } | { kind: "blocked" } | { kind: "error"; message: string };

/**
 * POST /api/auth/age-check (PLAN D5). The date of birth goes to the server
 * and nowhere else. A 404 means Pivot A was switched off since the page
 * loaded: sign up without a token, as before.
 */
async function checkAge(dateOfBirth: string): Promise<AgeCheck> {
  let response: Response;
  try {
    response = await fetch("/api/auth/age-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateOfBirth, timeZone: detectTimeZone() }),
    });
  } catch {
    return { kind: "error", message: "We could not reach idobata. Check your connection and try again." };
  }
  const body = await response.json().catch(() => null) as { data?: { token?: string }; error?: { code?: string; message?: string } } | null;
  if (response.ok && body?.data?.token) return { kind: "token", token: body.data.token };
  if (response.status === 404) return { kind: "legacy" };
  if (response.status === 403 && body?.error?.code === AGE_CHECK_ERROR_CODES.ageRequirement) return { kind: "blocked" };
  if (response.status === 422) return { kind: "error", message: "Enter your real date of birth." };
  return { kind: "error", message: body?.error?.message ?? "Age verification is not available right now. Please try again later." };
}

export function AuthForm({ mode, defaultEmail = "", pivot = false, next = null }: {
  mode: "login" | "signup";
  defaultEmail?: string;
  /** Pivot A: sign-up asks for a date of birth and passes the age check first. */
  pivot?: boolean;
  /** Login only: where to go afterwards, if it is a safe same-origin path. */
  next?: string | null;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [existingEmail, setExistingEmail] = useState("");
  const [underAge, setUnderAge] = useState(false);
  const router = useRouter();
  const signup = mode === "signup";
  const askAge = signup && pivot;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (isPreviewMode) {
      setStatus("Preview mode: authentication is simulated and nothing will be saved.");
      router.push(signup ? "/onboarding" : safeDestination(next));
      return;
    }
    setBusy(true); setStatus(""); setExistingEmail("");
    try {
      const supabase = createClient();
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      if (signup) {
        // Under Pivot A no account may be created without a fresh age token;
        // the before_user_created hook rejects the sign-up otherwise.
        let ageToken: string | null = null;
        if (askAge) {
          const age = await checkAge(String(form.get("dateOfBirth") ?? ""));
          if (age.kind === "blocked") { setUnderAge(true); return; }
          if (age.kind === "error") { setStatus(age.message); return; }
          if (age.kind === "token") ageToken = age.token;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
            ...(ageToken ? { data: { age_token: ageToken } } : {}),
          },
        });
        if (isExistingAccountError(error)) { setExistingEmail(email); return; }
        if (error && /age verification required/i.test(error.message)) {
          // A spent or expired token, or Pivot A switched on after this page
          // loaded without the date field: reload the form with fresh flags.
          setStatus("Your age check didn’t go through. Please try again.");
          router.refresh();
          return;
        }
        if (error) throw error;
        if (isExistingAccountSignUp(data)) { setExistingEmail(email); return; }
        if (!data.session) { setStatus("Check your email to confirm your account, then log in."); return; }
        router.replace("/onboarding");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // /home (the default) picks the landing page from the flags: the feed
        // today, and onboarding or tasks under Pivot A, where the feed may be off.
        router.replace(safeDestination(next));
      }
      router.refresh();
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusy(false); }
  }

  if (underAge) {
    // TODO(founder): under-18 block message copy (counsel). Also decide whether
    // to stop a retry with a different date in this browser.
    return (
      <div role="alert" className="mt-8 rounded-2xl border border-warning/30 bg-warning-soft p-5 text-sm leading-6 text-warning-ink">
        <strong>You need to be 18 or older to use idobata.</strong>
        <p className="mt-2">No account was created.</p>
      </div>
    );
  }

  return (
    // method="post": a submit before hydration must not put the password or
    // date of birth into the URL.
    <form onSubmit={submit} method="post" className="mt-8 space-y-5">
      {isPreviewMode && <div role="note" className="rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Supabase is not configured, so sign-in is simulated and data stays in this browser session only.</div>}
      {existingEmail && <div role="alert" className="rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning-ink"><strong>You already have an account.</strong> <span className="font-semibold">{existingEmail}</span> is already signed up — log in instead.<span className="mt-3 flex flex-wrap items-center gap-4"><Link className="btn btn-primary" href={`/login?email=${encodeURIComponent(existingEmail)}`}>Log in instead<ArrowRight size={17} /></Link><Link className="font-bold underline" href="/forgot-password">Forgot password?</Link><Link className="font-bold underline" href={`/resend-confirmation?email=${encodeURIComponent(existingEmail)}`}>Never confirmed it?</Link></span></div>}
      <div><label className="field-label" htmlFor="email">Email address</label><input className="field" id="email" name="email" type="email" autoComplete="email" placeholder="idobata@example.com" defaultValue={defaultEmail} required /></div>
      <div><div className="flex items-center justify-between"><label className="field-label" htmlFor="password">Password</label>{!signup && <Link href="/forgot-password" className="text-xs font-bold text-community hover:underline">Forgot password?</Link>}</div><div className="relative"><input className="field pr-12" id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={8} placeholder={signup ? "At least 8 characters" : "Your password"} required /><button type="button" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl text-muted hover:text-ink" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
      {/* TODO(founder): date-of-birth hint copy (counsel), especially what a real age-verification provider keeps. */}
      {askAge && <div><label className="field-label" htmlFor="date-of-birth">Date of birth</label><input className="field" id="date-of-birth" name="dateOfBirth" type="date" autoComplete="bday" required aria-describedby="date-of-birth-hint" /><p id="date-of-birth-hint" className="mt-1.5 text-xs text-muted">idobata is for adults 18 and over.</p></div>}
      {signup && <label className="flex items-start gap-3 text-sm leading-5 text-muted"><input type="checkbox" required className="mt-1 h-4 w-4 accent-[var(--brand)]" /><span>I agree to the <Link href="/terms" className="font-bold text-ink underline">Terms</Link> and <Link href="/privacy" className="font-bold text-ink underline">Privacy Policy</Link>.</span></label>}
      <button className="btn btn-primary w-full py-3" type="submit" disabled={busy}>{busy ? "Connecting…" : signup ? "Create my private list" : pivot ? "Log in" : "Open my feed"}<ArrowRight size={17} /></button>
      <p aria-live="polite" className="min-h-5 text-center text-sm font-bold text-muted">{status}</p>
      <p className="flex items-center justify-center gap-2 text-xs text-muted"><LockKeyhole size={14} /> New tasks always start private.</p>
      {signup && <p className="text-center text-sm text-muted">Already signed up? <Link href="/resend-confirmation" className="font-bold text-community hover:underline">Resend confirmation email</Link></p>}
      <p className="text-center text-sm text-muted">{signup ? "Already have a corner here?" : "New around here?"} <Link href={signup ? "/login" : "/sign-up"} className="font-bold text-community hover:underline">{signup ? "Log in" : "Create an account"}</Link></p>
    </form>
  );
}
