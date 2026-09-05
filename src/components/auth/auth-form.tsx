"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, isPreviewMode } from "@/lib/client/api";
import { isExistingAccountError, isExistingAccountSignUp } from "@/lib/auth/existing-account";

export function AuthForm({ mode, defaultEmail = "" }: { mode: "login" | "signup"; defaultEmail?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [existingEmail, setExistingEmail] = useState("");
  const router = useRouter();
  const signup = mode === "signup";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (isPreviewMode) {
      setStatus("Preview mode: authentication is simulated and nothing will be saved.");
      router.push(signup ? "/onboarding" : "/feed");
      return;
    }
    setBusy(true); setStatus(""); setExistingEmail("");
    try {
      const supabase = createClient();
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        });
        if (isExistingAccountError(error)) { setExistingEmail(email); return; }
        if (error) throw error;
        if (isExistingAccountSignUp(data)) { setExistingEmail(email); return; }
        if (!data.session) { setStatus("Check your email to confirm your account, then log in."); return; }
        router.replace("/onboarding");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/feed");
      }
      router.refresh();
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {isPreviewMode && <div role="note" className="rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Supabase is not configured, so sign-in is simulated and data stays in this browser session only.</div>}
      {existingEmail && <div role="alert" className="rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning-ink"><strong>You already have an account.</strong> <span className="font-semibold">{existingEmail}</span> is already signed up — log in instead.<span className="mt-3 flex flex-wrap items-center gap-4"><Link className="btn btn-primary" href={`/login?email=${encodeURIComponent(existingEmail)}`}>Log in instead<ArrowRight size={17} /></Link><Link className="font-bold underline" href="/forgot-password">Forgot password?</Link><Link className="font-bold underline" href={`/resend-confirmation?email=${encodeURIComponent(existingEmail)}`}>Never confirmed it?</Link></span></div>}
      <div><label className="field-label" htmlFor="email">Email address</label><input className="field" id="email" name="email" type="email" autoComplete="email" placeholder="idobata@example.com" defaultValue={defaultEmail} required /></div>
      <div><div className="flex items-center justify-between"><label className="field-label" htmlFor="password">Password</label>{!signup && <Link href="/forgot-password" className="text-xs font-bold text-community hover:underline">Forgot password?</Link>}</div><div className="relative"><input className="field pr-12" id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={8} placeholder={signup ? "At least 8 characters" : "Your password"} required /><button type="button" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl text-muted hover:text-ink" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
      {signup && <label className="flex items-start gap-3 text-sm leading-5 text-muted"><input type="checkbox" required className="mt-1 h-4 w-4 accent-[var(--brand)]" /><span>I agree to the <Link href="/terms" className="font-bold text-ink underline">Terms</Link> and <Link href="/privacy" className="font-bold text-ink underline">Privacy Policy</Link>.</span></label>}
      <button className="btn btn-primary w-full py-3" type="submit" disabled={busy}>{busy ? "Connecting…" : signup ? "Create my private list" : "Open my feed"}<ArrowRight size={17} /></button>
      <p aria-live="polite" className="min-h-5 text-center text-sm font-bold text-muted">{status}</p>
      <p className="flex items-center justify-center gap-2 text-xs text-muted"><LockKeyhole size={14} /> New tasks always start private.</p>
      {signup && <p className="text-center text-sm text-muted">Already signed up? <Link href="/resend-confirmation" className="font-bold text-community hover:underline">Resend confirmation email</Link></p>}
      <p className="text-center text-sm text-muted">{signup ? "Already have a corner here?" : "New around here?"} <Link href={signup ? "/login" : "/sign-up"} className="font-bold text-community hover:underline">{signup ? "Log in" : "Create an account"}</Link></p>
    </form>
  );
}
