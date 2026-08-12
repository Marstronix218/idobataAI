"use client";

import { useRouter } from "next/navigation";
import { Bell, LogOut, LockKeyhole, ShieldCheck, Trash2, UserRound, VolumeX, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types";

type Preferences = { reactions: boolean; replies: boolean; companion_activity: boolean; email_digest: boolean };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-community" : "bg-line-strong"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} /></button>; }

const previewProfile: UserProfile = { id: "preview", username: "mina", avatar_url: null, daily_goal: 3, interests: ["Work", "Learning", "Wellbeing"], default_task_visibility: "private", xp: 2840, current_streak: 6, last_completion_date: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

export function SettingsPanel() {
  const [profile, setProfile] = useState<UserProfile | null>(isPreviewMode ? previewProfile : null);
  const [prefs, setPrefs] = useState<Preferences>({ reactions: true, replies: true, companion_activity: true, email_digest: false });
  const [deleteOpen, setDeleteOpen] = useState(false); const [confirmation, setConfirmation] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(!isPreviewMode); const router = useRouter();
  useEffect(() => { if (isPreviewMode) return; const controller = new AbortController(); Promise.all([apiRequest<UserProfile>("/api/profile", { signal: controller.signal }), apiRequest<Preferences>("/api/notification-preferences", { signal: controller.signal })]).then(([loadedProfile, loadedPrefs]) => { setProfile(loadedProfile); setPrefs(loadedPrefs); }).catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }); return () => controller.abort(); }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return; const data = new FormData(event.currentTarget);
    const patch = { username: String(data.get("username")), avatarUrl: String(data.get("avatarUrl")) || null, dailyGoal: Number(data.get("dailyGoal")), interests: String(data.get("interests")).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20), defaultTaskVisibility: String(data.get("defaultVisibility")) as "private" | "public" };
    setBusy(true); setStatus("");
    try { const updated = isPreviewMode ? { ...profile, username: patch.username, avatar_url: patch.avatarUrl, daily_goal: patch.dailyGoal, interests: patch.interests, default_task_visibility: patch.defaultTaskVisibility } : await apiRequest<UserProfile>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) }); setProfile(updated); setStatus(`Settings saved.${isPreviewMode ? " Preview only." : ""}`); }
    catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  }
  async function logout() {
    if (isPreviewMode) { router.push("/"); return; }
    setBusy(true); const { error } = await createClient().auth.signOut(); if (error) { setStatus(error.message); setBusy(false); return; } router.replace("/login"); router.refresh();
  }
  async function deleteAccount() {
    if (confirmation !== "delete my account") return; setBusy(true); setStatus("");
    try { if (!isPreviewMode) await apiRequest<void>("/api/account", { method: "DELETE" }); setDeleteOpen(false); if (!isPreviewMode) await createClient().auth.signOut(); router.replace("/"); router.refresh(); }
    catch (error) { setStatus(errorMessage(error)); setBusy(false); }
  }
  async function updatePreference(key: keyof Preferences) {
    const next = !prefs[key];
    setPrefs((value) => ({ ...value, [key]: next }));
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest("/api/notification-preferences", { method: "PATCH", body: JSON.stringify({
        [key === "companion_activity" ? "companionActivity" : key === "email_digest" ? "emailDigest" : key]: next,
      }) });
      setStatus(`Notification preference saved.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setPrefs((value) => ({ ...value, [key]: !next }));
      setStatus(errorMessage(error));
    }
  }

  return <>
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Settings use demo values and will not persist.</div>}
    <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand">Your space, your rules</p><h1 className="page-title mt-1">Settings</h1><p className="mt-2 text-muted">Choose the pace and privacy that feels right.</p></div><button className="btn btn-secondary" onClick={() => void logout()} disabled={busy}><LogOut size={16} /> Log out</button></header>
    <div className="mt-7 grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)]"><nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Settings sections">{[[UserRound,"Profile"],[LockKeyhole,"Privacy"],[Bell,"Notifications"],[VolumeX,"Muted"],[ShieldCheck,"Safety"]].map(([Icon,label]) => { const Comp = Icon as typeof UserRound; return <a key={label as string} href={`#${String(label).toLowerCase()}`} className="btn btn-ghost shrink-0 justify-start"><Comp size={17} />{label as string}</a>; })}</nav>
      <div className="space-y-5">{profile ? <form onSubmit={saveProfile} className="space-y-5"><section id="profile" className="card p-5 sm:p-6"><div className="flex items-center gap-2"><UserRound size={19} className="text-brand" /><h2 className="display text-xl font-bold">Profile</h2></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="settings-username">Username</label><input className="field" id="settings-username" name="username" defaultValue={profile.username} pattern="[A-Za-z0-9_]{3,24}" required /></div><div><label className="field-label" htmlFor="settings-avatar">Avatar URL</label><input className="field" id="settings-avatar" name="avatarUrl" type="url" defaultValue={profile.avatar_url ?? ""} /></div><div><label className="field-label" htmlFor="settings-goal">Daily goal</label><input className="field" id="settings-goal" name="dailyGoal" type="number" min="1" max="50" defaultValue={profile.daily_goal} /></div><div><label className="field-label" htmlFor="settings-interests">Interests</label><input className="field" id="settings-interests" name="interests" defaultValue={profile.interests.join(", ")} placeholder="Work, Learning" /></div></div></section>
        <section id="privacy" className="card p-5 sm:p-6"><div className="flex items-center gap-2"><LockKeyhole size={19} className="text-brand" /><h2 className="display text-xl font-bold">Privacy and visibility</h2></div><label className="mt-5 block"><span className="field-label">Default for new tasks</span><select className="field" name="defaultVisibility" defaultValue={profile.default_task_visibility}><option value="private">Private</option><option value="public">Public progress</option></select></label><div className="mt-3"><PrivacyBadge isPublic={profile.default_task_visibility === "public"} /></div><button className="btn btn-primary mt-5" disabled={busy}>{busy ? "Saving…" : "Save profile and defaults"}</button></section></form> : <section className="soft-card p-8 text-center text-muted">Loading your settings…</section>}
      <section id="notifications" className="card p-5 sm:p-6"><div className="flex items-center gap-2"><Bell size={19} className="text-community" /><h2 className="display text-xl font-bold">Notifications</h2></div><div className="mt-4 divide-y divide-line">{[["reactions","Reactions","When someone encourages a post"],["replies","Replies","When people or companions join a conversation"],["companion_activity","AI companion engagement","Clearly labeled companion reactions and replies"],["email_digest","Weekly momentum note","A quiet recap each Sunday"]].map(([key,title,copy]) => <div key={key} className="flex items-center justify-between gap-4 py-4"><div><p className="font-bold">{title}</p><p className="mt-1 text-sm text-muted">{copy}</p></div><Toggle checked={prefs[key as keyof Preferences]} onChange={() => void updatePreference(key as keyof Preferences)} label={title} /></div>)}</div></section>
      <section id="muted" className="card p-5 sm:p-6"><div className="flex items-center gap-2"><VolumeX size={19} className="text-muted" /><h2 className="display text-xl font-bold">Muted companions</h2></div><p className="mt-5 text-sm text-muted">Mute controls are available on every companion profile.</p></section>
      <section id="safety" className="card border-danger/25 p-5 sm:p-6"><div className="flex items-center gap-2"><ShieldCheck size={19} className="text-danger" /><h2 className="display text-xl font-bold">Account and data</h2></div><div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">Delete account</p><p className="mt-1 max-w-lg text-sm leading-6 text-muted">Permanently remove your profile, tasks, posts, replies, and reactions.</p></div><button className="btn btn-danger shrink-0" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /> Delete account</button></div></section></div>
    </div>
    <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
    {deleteOpen && <div className="fixed inset-0 z-50 grid place-items-end bg-ink/40 backdrop-blur-sm sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-lg rounded-t-[1.5rem] bg-surface p-6 sm:rounded-[1.5rem]"><div className="flex items-start justify-between"><span className="grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger"><Trash2 size={21} /></span><button className="icon-btn border-0" aria-label="Close delete account dialog" onClick={() => setDeleteOpen(false)}><X size={18} /></button></div><h2 id="delete-title" className="display mt-5 text-2xl font-bold">Delete your account?</h2><p className="mt-3 leading-7 text-muted">This cannot be undone.</p><label className="field-label mt-6" htmlFor="delete-confirm">Type <strong>delete my account</strong> to confirm</label><input id="delete-confirm" className="field" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="btn btn-secondary" onClick={() => setDeleteOpen(false)}>Keep my account</button><button className="btn bg-danger text-white disabled:opacity-40" disabled={confirmation !== "delete my account" || busy} onClick={() => void deleteAccount()}>{busy ? "Deleting…" : "Permanently delete"}</button></div></section></div>}
  </>;
}
