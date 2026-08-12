"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Globe2, LockKeyhole, Upload } from "lucide-react";
import { useState } from "react";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";

const steps = ["Your corner", "A doable day", "Your interests", "Privacy first"];
const interests = ["Work", "Learning", "Wellbeing", "Life admin", "Creative work", "Home", "Fitness", "Routines"];

export function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [goal, setGoal] = useState(3);
  const [selected, setSelected] = useState(["Work", "Learning", "Wellbeing"]);
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toggleInterest = (item: string) => setSelected((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  async function finish() {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { setStep(0); setStatus("Choose a username with 3–24 letters, numbers, or underscores."); return; }
    if (isPreviewMode) { setStatus("Preview mode: your setup is available for this demo only and was not saved."); router.push("/tasks"); return; }
    setBusy(true); setStatus("");
    try {
      await apiRequest("/api/profile", { method: "PATCH", body: JSON.stringify({ username, avatarUrl: avatarUrl.trim() || null, dailyGoal: goal, interests: selected, defaultTaskVisibility: privacy }) });
      router.replace("/tasks"); router.refresh();
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen bg-canvas px-4 py-7 sm:py-12">
      <main id="main-content" className="mx-auto max-w-[720px]">
        <div className="mb-8 flex items-center justify-between"><Link href="/" className="display text-xl font-bold">idobata<span className="text-community">AI</span></Link><span className="text-sm font-bold text-muted">{step + 1} of {steps.length}</span></div>
        <div className="mb-8 grid grid-cols-4 gap-2" aria-label={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>{steps.map((label, index) => <div key={label}><div className={`h-1.5 rounded-full ${index <= step ? "bg-brand" : "bg-line"}`} /><span className={`mt-2 hidden text-xs font-bold sm:block ${index === step ? "text-ink" : "text-muted"}`}>{label}</span></div>)}</div>
        {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode:</strong> setup changes will not persist.</div>}
        <section className="card min-h-[490px] p-6 sm:p-10">
          {step === 0 && <div className="animate-rise"><p className="eyebrow">Your corner</p><h1 className="display mt-3 text-4xl font-bold">What should we call you?</h1><p className="mt-3 text-muted">Your unique username is how people and companions will know you in the community.</p><div className="mt-8 flex items-center gap-5"><span className="avatar avatar-human h-20 w-20 text-xl">{(username || "You").slice(0,2).toUpperCase()}</span><label className="btn btn-secondary" htmlFor="avatar-url"><Upload size={16} /> Add avatar URL</label></div><div className="mt-5"><label className="field-label" htmlFor="avatar-url">Avatar URL <span className="font-normal text-muted">optional</span></label><input id="avatar-url" type="url" className="field" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://…" /></div><div className="mt-5"><label className="field-label" htmlFor="username">Username</label><div className="relative"><span className="absolute left-3 top-3 text-muted">@</span><input id="username" className="field pl-8" value={username} onChange={(event) => setUsername(event.target.value)} pattern="[A-Za-z0-9_]{3,24}" required placeholder="mina" /></div><p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted"><Check size={13} /> 3–24 letters, numbers, or underscores</p></div></div>}
          {step === 1 && <div className="animate-rise"><p className="eyebrow">A doable day</p><h1 className="display balance mt-3 text-4xl font-bold">How many wins feels realistic?</h1><p className="mt-3 text-muted">This is a gentle guide, not a quota. You can change it anytime.</p><div className="mt-10 grid grid-cols-3 gap-3">{[1,3,5].map((value) => <button key={value} type="button" aria-pressed={goal === value} onClick={() => setGoal(value)} className={`min-h-28 rounded-2xl border p-4 text-left transition ${goal === value ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface hover:border-line-strong"}`}><span className="display text-4xl font-bold">{value}</span><span className="block text-sm font-bold text-muted">{value === 1 ? "win" : "wins"} a day</span></button>)}</div><p className="mt-6 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Three is a lovely place to start.</strong> Enough to notice momentum, with plenty of room for real life.</p></div>}
          {step === 2 && <div className="animate-rise"><p className="eyebrow">Your interests</p><h1 className="display balance mt-3 text-4xl font-bold">What kinds of progress matter to you?</h1><p className="mt-3 text-muted">Pick a few. We’ll use these for task categories and more relevant encouragement.</p><div className="mt-8 flex flex-wrap gap-3">{interests.map((item) => <button type="button" key={item} aria-pressed={selected.includes(item)} onClick={() => toggleInterest(item)} className={`btn ${selected.includes(item) ? "btn-community" : "btn-secondary"}`}>{selected.includes(item) && <Check size={15} />}{item}</button>)}</div><p className="mt-8 text-sm font-bold text-muted">{selected.length} selected · You can add your own categories later.</p></div>}
          {step === 3 && <div className="animate-rise"><p className="eyebrow">Privacy first</p><h1 className="display balance mt-3 text-4xl font-bold">How should new tasks begin?</h1><p className="mt-3 text-muted">Task visibility and posting are separate. Nothing is ever posted automatically.</p><div className="mt-8 space-y-3"><button type="button" aria-pressed={privacy === "private"} onClick={() => setPrivacy("private")} className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${privacy === "private" ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface"}`}><span className="grid h-11 w-11 place-items-center rounded-full bg-white text-brand"><LockKeyhole size={20} /></span><span className="flex-1"><span className="flex items-center gap-2 font-bold">Private <span className="badge badge-category">Recommended</span></span><span className="mt-1 block text-sm leading-6 text-muted">Only you can see the task. You can still share the completion later.</span></span></button><button type="button" aria-pressed={privacy === "public"} onClick={() => setPrivacy("public")} className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${privacy === "public" ? "border-community bg-community-soft shadow-[0_0_0_2px_var(--community)]" : "border-line bg-surface"}`}><span className="grid h-11 w-11 place-items-center rounded-full bg-white text-community"><Globe2 size={20} /></span><span><span className="font-bold">Public progress</span><span className="mt-1 block text-sm leading-6 text-muted">Signed-in community members can see its current status. It is not posted to the feed.</span></span></button></div></div>}
        </section>
        <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
        <div className="mt-2 flex items-center justify-between"><button type="button" className="btn btn-ghost" disabled={step === 0 || busy} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={16} /> Back</button>{step < steps.length - 1 ? <button type="button" className="btn btn-primary" onClick={() => { if (step === 0 && !/^[A-Za-z0-9_]{3,24}$/.test(username)) { setStatus("Choose a valid username before continuing."); return; } setStatus(""); setStep((value) => value + 1); }}>Continue <ArrowRight size={16} /></button> : <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>{busy ? "Saving…" : "Open my task list"} <ArrowRight size={16} /></button>}</div>
      </main>
    </div>
  );
}
