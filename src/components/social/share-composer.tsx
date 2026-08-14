"use client";

import Link from "next/link";
import { ArrowLeft, Check, Eye, Globe2, LockKeyhole, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { SocialPost, Task, UserProfile } from "@/types";

export function ShareComposer({ taskId }: { taskId: string }) {
  const [audience, setAudience] = useState<"public" | "private">("public");
  const [message, setMessage] = useState("");
  const [task, setTask] = useState<Task | null>(() => isPreviewMode ? { id: taskId, owner_id: "preview", title: "Draft the project kickoff outline", description: null, category: "Work", due_at: null, recurrence_rule: null, recurrence_instance_id: null, visibility: "public", status: "completed", xp_earned: 25, completed_at: "2026-08-12T12:14:00.000Z", created_at: "2026-08-12T12:14:00.000Z", updated_at: "2026-08-12T12:14:00.000Z" } : null); const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posted, setPosted] = useState(false); const [busy, setBusy] = useState(!isPreviewMode); const [status, setStatus] = useState("");
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([apiRequest<Task[]>("/api/tasks", { signal: controller.signal }), apiRequest<UserProfile>("/api/profile", { signal: controller.signal })]).then(([tasks, loadedProfile]) => {
      setTask(tasks.find((item) => item.id === taskId) ?? null); setProfile(loadedProfile);
    }).catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [taskId]);
  async function publish() {
    if (!task || task.status !== "completed" || posted) return; setBusy(true); setStatus("");
    try {
      if (!isPreviewMode) await apiRequest<SocialPost>(`/api/tasks/${encodeURIComponent(task.id)}/publish`, { method: "POST", body: JSON.stringify({ message: message.trim() || null, visibility: audience, recurrenceInstanceId: task.recurrence_instance_id }) });
      setPosted(true); setStatus(`Your win is posted.${isPreviewMode ? " Preview only." : " Repeated publishing is safely idempotent."}`);
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const name = profile?.username ?? "You"; const userInitials = name.slice(0, 2).toUpperCase();
  return <div className="app-page max-w-[980px]">
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Publishing is simulated and nothing is persisted.</div>}
    <header className="flex items-center gap-3"><Link href="/tasks" className="icon-btn" aria-label="Back to tasks"><ArrowLeft size={18} /></Link><div><p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Completed task</p><h1 className="page-title">Share this win</h1></div></header>
    {busy && !task ? <div className="soft-card mt-7 p-10 text-center text-muted">Loading your completed task…</div> : !task ? <div className="soft-card mt-7 p-10 text-center"><h2 className="display text-xl font-bold">Task not found.</h2><p className="mt-2 text-muted">Return to your tasks and choose a completed item.</p></div> : task.status !== "completed" ? <div className="soft-card mt-7 p-10 text-center"><h2 className="display text-xl font-bold">Complete this task before sharing.</h2><Link href="/tasks" className="btn btn-primary mt-5">Back to tasks</Link></div> : <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="card p-5 sm:p-7"><h2 className="display text-xl font-bold">Make it yours</h2><p className="mt-2 text-sm leading-6 text-muted">Your task visibility does not change when you post.</p><div className="mt-6"><label className="field-label" htmlFor="task-title">Task</label><input id="task-title" className="field font-bold" value={task.title} readOnly /></div><div className="mt-5"><div className="flex items-center justify-between"><label className="field-label" htmlFor="post-message">Personal note <span className="font-normal text-muted">optional</span></label><span className="text-xs font-bold text-muted">{message.length}/500</span></div><textarea id="post-message" className="field min-h-32 resize-y leading-6" maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What made this win meaningful?" /></div><fieldset className="mt-6"><legend className="field-label">Who can see this post?</legend><div className="grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={audience === "public"} onClick={() => setAudience("public")} className={`flex items-start gap-3 rounded-2xl border p-4 text-left ${audience === "public" ? "border-community bg-community-soft" : "border-line"}`}><Globe2 size={20} className="text-community" /><span><strong>Community</strong><small className="mt-1 block text-muted">All signed-in members</small></span></button><button type="button" aria-pressed={audience === "private"} onClick={() => setAudience("private")} className={`flex items-start gap-3 rounded-2xl border p-4 text-left ${audience === "private" ? "border-brand bg-brand-soft" : "border-line"}`}><LockKeyhole size={20} className="text-brand" /><span><strong>Only me</strong><small className="mt-1 block text-muted">A private accomplishment</small></span></button></div></fieldset><div className="mt-6"><p className="field-label">Included with this accomplishment</p><p className="mt-2 text-sm leading-6 text-muted">The completion snapshot includes the task title, category, XP, streak, and completion time shown in the preview.</p></div></section>
      <aside className="lg:sticky lg:top-6 lg:self-start"><div className="mb-3 flex items-center gap-2 text-sm font-bold text-muted"><Eye size={16} /> Post preview</div><article className="card p-5"><header className="flex items-center gap-3"><Avatar initials={userInitials} avatarUrl={profile?.avatar_url} name={name} /><div><div className="flex items-center gap-2"><p className="font-bold">{name}</p><PrivacyBadge isPublic={audience === "public"} /></div><p className="text-xs text-muted">Just now · Completed a task</p></div></header>{message && <p className="mt-4 leading-7">{message}</p>}<div className="mt-4 rounded-2xl border border-line bg-canvas/65 p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">Completed</p><p className="mt-1 font-bold">{task.title}</p><div className="mt-3 flex flex-wrap gap-2">{task.category && <span className="badge badge-category">{task.category}</span>}<span className="badge badge-xp">+{task.xp_earned} XP</span>{profile && <span className="badge badge-streak">🔥 {profile.current_streak}-day streak</span>}<span className="badge badge-private">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.completed_at!))}</span></div></div></article>{posted ? <div className="animate-rise mt-4 rounded-2xl bg-success-soft p-5 text-success" role="status"><div className="flex items-center gap-2 font-bold"><Check size={18} /> Your win is posted.</div><Link href="/feed" className="btn btn-community mt-4 w-full">View in feed</Link></div> : <button className="btn btn-primary mt-4 w-full py-3" onClick={() => void publish()} disabled={busy}><Send size={17} /> {busy ? "Posting…" : "Post to Social"}</button>}<Link href="/tasks" className="btn btn-ghost mt-2 w-full">Keep private for now</Link></aside>
    </div>}
    <p className="mt-4 text-sm font-bold text-muted" aria-live="polite">{status}</p>
  </div>;
}
