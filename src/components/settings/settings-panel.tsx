"use client";

import { useRouter } from "next/navigation";
import { Bell, Info, LockKeyhole, LogOut, MessageSquare, ShieldCheck, SlidersHorizontal, Smartphone, Trash2, VolumeX, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { BetaBadge, PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types";

type Preferences = {
  reactions: boolean;
  replies: boolean;
  companion_activity: boolean;
};

type BlockedPerson = { id: string; name: string; username: string; avatarUrl: string | null };
type MutedCompanion = { id: string; name: string; slug: string; avatarUrl: string | null };
type SafetyList<T> = { items: T[] };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-community" : "bg-line-strong"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} /></button>;
}

const previewProfile: UserProfile = {
  id: "preview",
  username: "mina",
  display_name: "Mina Mori",
  bio: "Building calmer routines, one honest win at a time.",
  avatar_url: null,
  profile_visibility: "private",
  daily_goal: 3,
  interests: ["Work", "Learning", "Wellbeing"],
  default_task_visibility: "private",
  completion_visibility: "private",
  xp: 2840,
  current_streak: 6,
  last_completion_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const previewBlockedPeople: BlockedPerson[] = [
  { id: "preview-casey", name: "Casey Park", username: "casey", avatarUrl: null },
];
const previewMutedCompanions: MutedCompanion[] = [
  { id: "preview-orbit", name: "Orbit", slug: "orbit", avatarUrl: "/companions/orbit.webp" },
];

function initials(name: string) {
  return name.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function SettingsPanel() {
  const [profile, setProfile] = useState<UserProfile | null>(isPreviewMode ? previewProfile : null);
  const [prefs, setPrefs] = useState<Preferences>({ reactions: true, replies: true, companion_activity: true });
  const [blockedPeople, setBlockedPeople] = useState<BlockedPerson[]>(isPreviewMode ? previewBlockedPeople : []);
  const [mutedCompanions, setMutedCompanions] = useState<MutedCompanion[]>(isPreviewMode ? previewMutedCompanions : []);
  const [safetyBusyId, setSafetyBusyId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [busy, setBusy] = useState(!isPreviewMode);
  const router = useRouter();

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest<UserProfile>("/api/profile", { signal: controller.signal }),
      apiRequest<Preferences>("/api/notification-preferences", { signal: controller.signal }),
    ]).then(([loadedProfile, loadedPrefs]) => {
      setProfile(loadedProfile);
      setPrefs(loadedPrefs);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });

    Promise.allSettled([
      apiRequest<SafetyList<BlockedPerson>>("/api/blocks", { signal: controller.signal }),
      apiRequest<SafetyList<MutedCompanion>>("/api/companion-mutes", { signal: controller.signal }),
    ]).then(([blocksResult, mutesResult]) => {
      if (controller.signal.aborted) return;
      if (blocksResult.status === "fulfilled") setBlockedPeople(blocksResult.value.items);
      if (mutesResult.status === "fulfilled") setMutedCompanions(mutesResult.value.items);
      if (blocksResult.status === "rejected" || mutesResult.status === "rejected") {
        setStatus("Your settings loaded, but some safety lists could not be refreshed.");
      }
    });
    return () => controller.abort();
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const data = new FormData(event.currentTarget);
    const patch = {
      dailyGoal: Number(data.get("dailyGoal")),
      profileVisibility: String(data.get("profileVisibility")) as "private" | "public",
      completionVisibility: String(data.get("completionVisibility")) as "private" | "public",
    };
    setBusy(true);
    setStatus("");
    try {
      const updated = isPreviewMode
        ? { ...profile, daily_goal: patch.dailyGoal, profile_visibility: patch.profileVisibility, completion_visibility: patch.completionVisibility }
        : await apiRequest<UserProfile>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
      setProfile(updated);
      setStatus(`Settings saved.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (isPreviewMode) {
      router.push("/");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  async function deleteAccount() {
    if (confirmation !== "delete my account") return;
    setBusy(true);
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest<void>("/api/account", { method: "DELETE" });
      setDeleteOpen(false);
      if (!isPreviewMode) await createClient().auth.signOut();
      router.replace("/");
      router.refresh();
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
    }
  }

  async function updatePreference(key: keyof Preferences) {
    const next = !prefs[key];
    setPrefs((value) => ({ ...value, [key]: next }));
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest("/api/notification-preferences", { method: "PATCH", body: JSON.stringify({
        [key === "companion_activity" ? "companionActivity" : key]: next,
      }) });
      setStatus(`Notification preference saved.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setPrefs((value) => ({ ...value, [key]: !next }));
      setStatus(errorMessage(error));
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const category = String(data.get("feedbackType")) as "idea" | "issue" | "other";
    const message = String(data.get("feedbackMessage"));
    setFeedbackBusy(true);
    setFeedbackStatus("");
    try {
      if (!isPreviewMode) {
        await apiRequest<{ id: string }>("/api/feedback", {
          method: "POST",
          body: JSON.stringify({ category, message }),
        });
      }
      form.reset();
      setFeedbackStatus(`Thanks. Your feedback was sent.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setFeedbackStatus(errorMessage(error));
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function unblock(person: BlockedPerson) {
    setSafetyBusyId(`person-${person.id}`);
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/blocks/${person.id}`, { method: "DELETE" });
      setBlockedPeople((current) => current.filter((item) => item.id !== person.id));
      setStatus(`${person.name} unblocked.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setSafetyBusyId(null);
    }
  }

  async function unmute(companion: MutedCompanion) {
    setSafetyBusyId(`companion-${companion.id}`);
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/companion-mutes/${companion.id}`, { method: "DELETE" });
      setMutedCompanions((current) => current.filter((item) => item.id !== companion.id));
      setStatus(`${companion.name} unmuted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setSafetyBusyId(null);
    }
  }

  return <>
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Settings use demo values and will not persist.</div>}
    <header className="flex items-start justify-between gap-4">
      <div><p className="text-sm font-bold text-brand">Your space, your rules</p><h1 className="page-title mt-1">Settings</h1></div>
      <button className="btn btn-secondary" onClick={() => void logout()} disabled={busy}><LogOut size={16} /> Log out</button>
    </header>

    <div className="mt-7 grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)]">
      <nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Settings sections">
        {[[SlidersHorizontal, "Preferences"], [LockKeyhole, "Privacy"], [Bell, "Notifications"], [VolumeX, "Muted"], [MessageSquare, "Feedback"], [Info, "About"], [ShieldCheck, "Safety"]].map(([Icon, label]) => {
          const Comp = Icon as typeof SlidersHorizontal;
          return <a key={label as string} href={`#${String(label).toLowerCase()}`} className="btn btn-ghost shrink-0 justify-start"><Comp size={17} />{label as string}</a>;
        })}
      </nav>

      <div className="space-y-5">
        {profile ? <form onSubmit={saveSettings} className="space-y-5">
          <section id="preferences" className="card p-5 sm:p-6">
            <div className="flex items-center gap-2"><SlidersHorizontal size={19} className="text-brand" /><h2 className="display text-xl font-bold">Task preferences</h2></div>
            <p className="mt-2 text-sm leading-6 text-muted">Tune the daily target shown in your private task workspace.</p>
            <label className="mt-5 block"><span className="field-label">Daily goal</span><input className="field max-w-40" name="dailyGoal" type="number" min="1" max="50" defaultValue={profile.daily_goal} /></label>
          </section>

          <section id="privacy" className="card p-5 sm:p-6">
            <div className="flex items-center gap-2"><LockKeyhole size={19} className="text-brand" /><h2 className="display text-xl font-bold">Privacy and visibility</h2></div>
            <label className="mt-5 block"><span className="field-label">Who can view your profile details and timeline?</span><select className="field" name="profileVisibility" defaultValue={profile.profile_visibility}><option value="private">Only me</option><option value="public">Other signed-in users</option></select></label>
            <p className="mt-2 text-sm leading-6 text-muted">Your name, handle, and avatar can still appear on posts you share. A public profile also shows only posts and task progress you already marked Public. Private tasks and posts stay hidden.</p>
            <label className="mt-5 block"><span className="field-label">Who can see posted task completions?</span><select className="field" name="completionVisibility" defaultValue={profile.completion_visibility}><option value="private">Only me</option><option value="public">Other signed-in users</option></select></label>
            <div className="mt-3"><PrivacyBadge isPublic={profile.completion_visibility === "public"} /></div>
            <p className="mt-3 text-sm leading-6 text-muted">This applies when you press Post after completing a task. AI accounts remain active in the feed either way.</p>
            <button className="btn btn-primary mt-5" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          </section>
        </form> : <section className="soft-card p-8 text-center text-muted">Loading your settings…</section>}

        <section id="notifications" className="card p-5 sm:p-6">
          <div className="flex items-center gap-2"><Bell size={19} className="text-community" /><h2 className="display text-xl font-bold">Notifications</h2></div>
          <div className="mt-4 divide-y divide-line">{[["reactions", "Likes and reposts", "When someone likes or reposts a post"], ["replies", "Replies and quotes", "When people or AI followers join a conversation or quote your post"], ["companion_activity", "AI follower activity", "Clearly labeled AI follower posts, likes, and replies"]].map(([key, title, copy]) => <div key={key} className="flex items-center justify-between gap-4 py-4"><div><p className="font-bold">{title}</p><p className="mt-1 text-sm text-muted">{copy}</p></div><Toggle checked={prefs[key as keyof Preferences]} onChange={() => void updatePreference(key as keyof Preferences)} label={title} /></div>)}</div>
        </section>

        <section id="muted" className="card p-5 sm:p-6">
          <div className="flex items-center gap-2"><VolumeX size={19} className="text-muted" /><h2 className="display text-xl font-bold">Muted AI companions</h2></div>
          <p className="mt-2 text-sm text-muted">Muted AI companions stay out of your feed. You can also manage mute controls from their profiles.</p>
          {mutedCompanions.length ? <ul className="mt-4 divide-y divide-line" aria-label="Muted AI companions">{mutedCompanions.map((companion) => <li key={companion.id} className="flex items-center gap-3 py-4"><Avatar initials={initials(companion.name)} avatarUrl={companion.avatarUrl} name={companion.name} ai /><div className="min-w-0 flex-1"><p className="truncate font-bold">{companion.name}</p><p className="truncate text-sm text-muted">@{companion.slug} · AI companion</p></div><button type="button" className="btn btn-secondary shrink-0" aria-label={`Unmute ${companion.name}`} disabled={safetyBusyId !== null} onClick={() => void unmute(companion)}>{safetyBusyId === `companion-${companion.id}` ? "Unmuting…" : "Unmute"}</button></li>)}</ul> : <p className="soft-card mt-4 p-5 text-center text-sm text-muted">You haven’t muted any AI companions.</p>}
        </section>

        <section id="feedback" className="card p-5 sm:p-6">
          <div className="flex items-center gap-2"><MessageSquare size={19} className="text-brand" /><h2 className="display text-xl font-bold">Feedback</h2></div>
          <p className="mt-2 text-sm leading-6 text-muted">Share an idea, tell us what isn’t working, or leave a note for the product team.</p>
          <form className="mt-5 space-y-4" onSubmit={submitFeedback}>
            <label className="block"><span className="field-label">Feedback type</span><select className="field" name="feedbackType" defaultValue="idea"><option value="idea">Idea</option><option value="issue">Something isn’t working</option><option value="other">Other</option></select></label>
            <label className="block"><span className="field-label">Your feedback</span><textarea className="field min-h-32 resize-y" name="feedbackMessage" minLength={5} maxLength={2000} required placeholder="What would make Idobata more useful for you?" /></label>
            <p className="text-sm leading-6 text-muted">5–2,000 characters. Your feedback is linked to your account and visible only to the product team.</p>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <button className="btn btn-primary" disabled={feedbackBusy}>{feedbackBusy ? "Sending…" : "Send feedback"}</button>
              <p className="min-h-5 text-sm font-bold text-muted" aria-live="polite">{feedbackStatus}</p>
            </div>
          </form>
        </section>

        <section id="about" className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2"><Info size={19} className="text-sun" /><h2 className="display text-xl font-bold">About this beta</h2><BetaBadge /></div>
          <p className="mt-3 text-sm leading-6 text-muted">Idobata AI is a beta product. Features, wording, and limits change while we learn what the completed-task loop is actually good for, AI chat runs under a daily cap, and the terms and privacy notice are still being reviewed. Nothing here is billed, and account deletion under <a href="#safety" className="font-bold text-brand hover:underline">Account and data</a> removes your profile, tasks, posts, replies, and reactions.</p>
          <p className="mt-3 text-sm leading-6 text-muted">Found something broken or surprising? The <a href="#feedback" className="font-bold text-brand hover:underline">feedback form</a> above goes straight to the product team.</p>
          <div className="mt-5 flex gap-3 border-t border-line pt-5">
            <span className="mt-0.5 shrink-0 text-community"><Smartphone size={19} /></span>
            <div>
              <p className="font-bold">Using Idobata AI on your phone</p>
              <p className="mt-1 text-sm leading-6 text-muted">Idobata AI is built for mobile browsers and installs to your home screen: in Safari on iOS, tap Share and then Add to Home Screen; in Chrome on Android, use Install app.</p>
              <p className="mt-2 text-sm leading-6 text-muted">A native iOS app is in development against this same account and backend, starting with your task list, completing tasks, and sharing a win. The feed, chat, and AI Personas stay web-only for now, and there is no release date yet.</p>
            </div>
          </div>
        </section>

        <section id="safety" className="card border-danger/25 p-5 sm:p-6">
          <div className="flex items-center gap-2"><ShieldCheck size={19} className="text-danger" /><h2 className="display text-xl font-bold">Account and data</h2></div>
          <div className="mt-5"><h3 className="font-bold">Blocked people</h3><p className="mt-1 text-sm leading-6 text-muted">Blocked people cannot interact with you, and you won’t see each other’s community activity.</p>{blockedPeople.length ? <ul className="mt-3 divide-y divide-line" aria-label="Blocked people">{blockedPeople.map((person) => <li key={person.id} className="flex items-center gap-3 py-4"><Avatar initials={initials(person.name)} avatarUrl={person.avatarUrl} name={person.name} /><div className="min-w-0 flex-1"><p className="truncate font-bold">{person.name}</p><p className="truncate text-sm text-muted">@{person.username}</p></div><button type="button" className="btn btn-secondary shrink-0" aria-label={`Unblock ${person.name}`} disabled={safetyBusyId !== null} onClick={() => void unblock(person)}>{safetyBusyId === `person-${person.id}` ? "Unblocking…" : "Unblock"}</button></li>)}</ul> : <p className="soft-card mt-4 p-5 text-center text-sm text-muted">You haven’t blocked anyone.</p>}</div>
          <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">Delete account</p><p className="mt-1 max-w-lg text-sm leading-6 text-muted">Permanently remove your profile, tasks, posts, replies, and reactions.</p></div><button className="btn btn-danger shrink-0" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /> Delete account</button></div>
        </section>
      </div>
    </div>

    <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>

    {deleteOpen && <div className="fixed inset-0 z-50 grid place-items-end bg-overlay/70 backdrop-blur-sm sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-lg rounded-t-[1.5rem] bg-surface p-6 sm:rounded-[1.5rem]"><div className="flex items-start justify-between"><span className="grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger"><Trash2 size={21} /></span><button className="icon-btn border-0" aria-label="Close delete account dialog" onClick={() => setDeleteOpen(false)}><X size={18} /></button></div><h2 id="delete-title" className="display mt-5 text-2xl font-bold">Delete your account?</h2><p className="mt-3 leading-7 text-muted">This cannot be undone.</p><label className="field-label mt-6" htmlFor="delete-confirm">Type <strong>delete my account</strong> to confirm</label><input id="delete-confirm" className="field" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="btn btn-secondary" onClick={() => setDeleteOpen(false)}>Keep my account</button><button className="btn bg-danger text-white disabled:opacity-40" disabled={confirmation !== "delete my account" || busy} onClick={() => void deleteAccount()}>{busy ? "Deleting…" : "Permanently delete"}</button></div></section></div>}
  </>;
}
