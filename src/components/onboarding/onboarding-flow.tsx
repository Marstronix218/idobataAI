"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Globe2, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { AvatarPicker } from "@/components/profile/avatar-picker";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";

const steps = ["Your corner", "Your interests", "Privacy first"];
const interests = ["Work", "Learning", "Wellbeing", "Life admin", "Creative work", "Home", "Fitness", "Routines"];

export function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState(["Work", "Learning", "Wellbeing"]);
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  // Profile visibility and the default audience for a post used to be written
  // from this single toggle. They answer different questions, and the product
  // contract says so explicitly: making progress public and creating a social
  // post are separate choices. Conflating them meant a user who chose the
  // recommended Private profile also silently set every win they later chose to
  // post to "Only me" — so doing everything right published nothing to anyone.
  const [shareAudience, setShareAudience] = useState<"private" | "public">("public");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toggleInterest = (item: string) => setSelected((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  async function finish() {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { setStep(0); setStatus("Choose a username with 3–24 letters, numbers, or underscores."); return; }
    // Onboarding used to end on the feed — a wall of posts from strangers, with
    // no task of your own — despite the landing page promising "start with one
    // private task". It now ends where the product actually begins.
    if (isPreviewMode) { setStatus("Preview mode: your setup is available for this demo only and was not saved."); router.push("/tasks"); return; }
    setBusy(true); setStatus("");
    try {
      await apiRequest("/api/profile", { method: "PATCH", body: JSON.stringify({ username, avatarUrl, interests: selected, profileVisibility: privacy, completionVisibility: shareAudience }) });
      router.replace("/tasks"); router.refresh();
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return (
    <div className="app-theme min-h-screen bg-canvas px-4 py-7 text-ink sm:py-12">
      <main id="main-content" className="mx-auto max-w-[720px]">
        <div className="mb-8 flex items-center justify-between"><Link href="/" className="display text-xl font-bold">idobata<span className="text-community">AI</span></Link><span className="text-sm font-bold text-muted">{step + 1} of {steps.length}</span></div>
        <div className="mb-8 grid grid-cols-3 gap-2" aria-label={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>{steps.map((label, index) => <div key={label}><div className={`h-1.5 rounded-full ${index <= step ? "bg-brand" : "bg-line"}`} /><span className={`mt-2 hidden text-xs font-bold sm:block ${index === step ? "text-ink" : "text-muted"}`}>{label}</span></div>)}</div>
        {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode:</strong> setup changes will not persist.</div>}
        <section className="card min-h-[490px] p-6 sm:p-10">
          {step === 0 && <div className="animate-rise"><p className="eyebrow">Your corner</p><h1 className="display mt-3 text-4xl font-bold">What should we call you?</h1><p className="mt-3 text-muted">Your unique username is how people and AI followers will know you in the community.</p><div className="mt-8"><label className="field-label" htmlFor="username">Username</label><div className="relative"><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">@</span><input id="username" className="field field-prefixed" value={username} onChange={(event) => setUsername(event.target.value)} pattern="[A-Za-z0-9_]{3,24}" required placeholder="mina" /></div><p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted"><Check size={13} /> 3–24 letters, numbers, or underscores</p></div><div className="mt-7"><AvatarPicker value={avatarUrl} onChange={setAvatarUrl} initials={(username || "You").slice(0, 2).toUpperCase()} disabled={busy} /></div></div>}
          {step === 1 && <div className="animate-rise"><p className="eyebrow">Your interests</p><h1 className="display balance mt-3 text-4xl font-bold">What kinds of progress matter to you?</h1><p className="mt-3 text-muted">Pick a few. We’ll use these for task categories and more relevant encouragement.</p><div className="mt-8 flex flex-wrap gap-3">{interests.map((item) => <button type="button" key={item} aria-pressed={selected.includes(item)} onClick={() => toggleInterest(item)} className={`btn ${selected.includes(item) ? "btn-community" : "btn-secondary"}`}>{selected.includes(item) && <Check size={15} />}{item}</button>)}</div><p className="mt-8 text-sm font-bold text-muted">{selected.length} selected · You can add your own categories later.</p></div>}
          {step === 2 && <div className="animate-rise"><p className="eyebrow">Privacy first</p><h1 className="display balance mt-3 text-4xl font-bold">Who can see your shared progress?</h1><p className="mt-3 text-muted">Two separate questions. A completion appears in the feed only after you press Post. AI accounts stay active either way.</p><div className="mt-8 space-y-3"><button type="button" aria-pressed={privacy === "private"} onClick={() => setPrivacy("private")} className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${privacy === "private" ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface"}`}><span className="grid h-11 w-11 place-items-center rounded-full bg-white text-brand"><LockKeyhole size={20} /></span><span className="flex-1"><span className="flex items-center gap-2 font-bold">Private <span className="badge badge-category">Recommended</span></span><span className="mt-1 block text-sm leading-6 text-muted">Only you can open your social profile. Nobody can browse your page.</span></span></button><button type="button" aria-pressed={privacy === "public"} onClick={() => setPrivacy("public")} className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${privacy === "public" ? "border-community bg-community-soft shadow-[0_0_0_2px_var(--community)]" : "border-line bg-surface"}`}><span className="grid h-11 w-11 place-items-center rounded-full bg-white text-community"><Globe2 size={20} /></span><span><span className="font-bold">Public</span><span className="mt-1 block text-sm leading-6 text-muted">Signed-in users can open your profile and see completions you explicitly post publicly.</span></span></button></div>
          <div className="mt-8 border-t border-line pt-6">
            <h2 className="display text-xl font-bold">And when you do choose to post a win?</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Separate from your profile. Completing a task still never posts anything — this only sets who sees a win once you press Post.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" aria-pressed={shareAudience === "public"} onClick={() => setShareAudience("public")} className={`rounded-2xl border p-4 text-left ${shareAudience === "public" ? "border-community bg-community-soft shadow-[0_0_0_2px_var(--community)]" : "border-line bg-surface"}`}><span className="flex items-center gap-2 font-bold"><Globe2 size={17} /> The community</span><span className="mt-1 block text-sm leading-6 text-muted">Where encouragement comes from.</span></button>
              <button type="button" aria-pressed={shareAudience === "private"} onClick={() => setShareAudience("private")} className={`rounded-2xl border p-4 text-left ${shareAudience === "private" ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface"}`}><span className="flex items-center gap-2 font-bold"><LockKeyhole size={17} /> Only me</span><span className="mt-1 block text-sm leading-6 text-muted">Keep a private record instead.</span></button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">You can change this for any individual post, and afterwards.</p>
          </div>
        </div>}
        </section>
        <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
        <div className="mt-2 flex items-center justify-between"><button type="button" className="btn btn-ghost" disabled={step === 0 || busy} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={16} /> Back</button>{step < steps.length - 1 ? <button type="button" className="btn btn-primary" onClick={() => { if (step === 0 && !/^[A-Za-z0-9_]{3,24}$/.test(username)) { setStatus("Choose a valid username before continuing."); return; } setStatus(""); setStep((value) => value + 1); }}>Continue <ArrowRight size={16} /></button> : <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>{busy ? "Saving…" : "Add my first task"} <ArrowRight size={16} /></button>}</div>
      </main>
    </div>
  );
}
