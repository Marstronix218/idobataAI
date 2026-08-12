"use client";

import Link from "next/link";
import { CalendarDays, Check, Circle, Flame, Globe2, LockKeyhole, MoreHorizontal, Plus, Repeat2, Search, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { tasks as demoTasks } from "@/data/demo";
import { PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { Task, UserProfile } from "@/types";

type Filter = "Today" | "Upcoming" | "Completed" | "All";

const previewTasks: Task[] = demoTasks.map((task, index) => ({
  id: task.id, owner_id: "preview", title: task.title, description: null, category: task.category,
  due_at: task.due === "Today" ? new Date().toISOString() : task.due === "Tomorrow" ? new Date(Date.now() + 86_400_000).toISOString() : null,
  recurrence_rule: task.recurring ? "weekdays" : null, recurrence_instance_id: null,
  visibility: task.isPublic ? "public" : "private", status: task.completed ? "completed" : "pending",
  xp_earned: task.xp, completed_at: task.completed ? new Date().toISOString() : null,
  created_at: new Date(Date.now() - index * 1000).toISOString(), updated_at: new Date().toISOString(),
}));

function dueLabel(value: string | null) {
  if (!value) return "No due date";
  const due = new Date(value); const today = new Date();
  if (due.toDateString() === today.toDateString()) return "Today";
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due);
}

export function TaskBoard() {
  const [items, setItems] = useState<Task[]>(isPreviewMode ? previewTasks : []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [filter, setFilter] = useState<Filter>("Today");
  const [category, setCategory] = useState("All");
  const [draft, setDraft] = useState("");
  const [justCompleted, setJustCompleted] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(!isPreviewMode);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (isPreviewMode) return;
    setLoading(true);
    try {
      const [tasks, loadedProfile] = await Promise.all([
        apiRequest<Task[]>("/api/tasks", { signal }),
        apiRequest<UserProfile>("/api/profile", { signal }),
      ]);
      setItems(tasks); setProfile(loadedProfile);
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setAnnouncement(errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([apiRequest<Task[]>("/api/tasks", { signal: controller.signal }), apiRequest<UserProfile>("/api/profile", { signal: controller.signal })])
      .then(([tasks, loadedProfile]) => { setItems(tasks); setProfile(loadedProfile); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setAnnouncement(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((task) => task.category).filter(Boolean) as string[]))], [items]);
  const visible = useMemo(() => items.filter((task) => {
    const due = dueLabel(task.due_at);
    const statusMatch = filter === "All" || (filter === "Completed" ? task.status === "completed" : filter === "Upcoming" ? due !== "Today" && task.status === "pending" : due === "Today" && task.status === "pending");
    return statusMatch && (category === "All" || task.category === category);
  }), [category, filter, items]);

  async function complete(task: Task) {
    const next = task.status === "pending" ? "completed" : "pending";
    setBusyId(task.id); setAnnouncement("");
    try {
      const updated = isPreviewMode ? { ...task, status: next, completed_at: next === "completed" ? new Date().toISOString() : null, xp_earned: next === "completed" ? Math.max(10, task.xp_earned) : task.xp_earned } as Task : await apiRequest<Task>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setItems((current) => current.map((item) => item.id === task.id ? updated : item));
      setJustCompleted(next === "completed" ? updated : null);
      setAnnouncement(next === "completed" ? `${task.title} completed. Nothing was posted.` : `${task.title} moved back to open tasks.`);
    } catch (error) { setAnnouncement(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function addTask() {
    const title = draft.trim(); if (!title) return;
    setBusyId("new"); setAnnouncement("");
    try {
      const created = isPreviewMode ? { ...previewTasks[0], id: `preview-${Date.now()}`, title, visibility: profile?.default_task_visibility ?? "private", status: "pending", completed_at: null, xp_earned: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as Task : await apiRequest<Task>("/api/tasks", { method: "POST", body: JSON.stringify({ title }) });
      setItems((current) => [created, ...current]); setDraft("");
      setAnnouncement(`${title} added ${created.visibility === "private" ? "privately" : "with public progress"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setAnnouncement(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const data = new FormData(event.currentTarget);
    const recurrence = String(data.get("recurrenceRule"));
    const patch = { title: String(data.get("title")), category: String(data.get("category")) || null, dueAt: data.get("dueAt") ? new Date(`${data.get("dueAt")}T12:00:00`).toISOString() : null, recurrenceRule: recurrence ? recurrence as "daily" | "weekdays" | "weekly" : null, visibility: String(data.get("visibility")) as "private" | "public" };
    setBusyId(editing.id);
    try {
      const updated = isPreviewMode ? { ...editing, title: patch.title, category: patch.category, due_at: patch.dueAt, recurrence_rule: patch.recurrenceRule, visibility: patch.visibility } : await apiRequest<Task>(`/api/tasks/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setItems((current) => current.map((task) => task.id === updated.id ? updated : task)); setEditing(null); setAnnouncement("Task changes saved.");
    } catch (error) { setAnnouncement(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function remove(task: Task) {
    setBusyId(task.id);
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/tasks/${task.id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== task.id)); setEditing(null); setAnnouncement(`${task.title} deleted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setAnnouncement(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  const completedToday = items.filter((task) => task.status === "completed" && task.completed_at && new Date(task.completed_at).toDateString() === new Date().toDateString()).length;
  const publicCount = items.filter((task) => task.visibility === "public").length;
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
    <div className="min-w-0">
      {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Tasks use demo data and reset when you reload.</div>}
      <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p><h1 className="page-title mt-1">Your doable day.</h1><p className="mt-2 text-muted">One clear next step is plenty.</p></div><button className="icon-btn" aria-label="Refresh tasks" onClick={() => void load()}><Search size={19} /></button></header>
      <section className="card mt-7 overflow-hidden border-brand/25"><div className="flex gap-3 p-3 sm:p-4"><label htmlFor="quick-task" className="sr-only">Add a task</label><input id="quick-task" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }} className="field min-w-0 flex-1 border-0 bg-transparent shadow-none" placeholder="What would feel good to finish?" maxLength={160} /><button className="btn btn-primary shrink-0 px-4" onClick={() => void addTask()} disabled={busyId === "new"}><Plus size={18} /><span className="hidden sm:inline">Add task</span></button></div><div className="flex items-center gap-2 border-t border-line bg-canvas/55 px-4 py-2.5 text-xs font-bold text-muted"><LockKeyhole size={13} /> New tasks start {profile?.default_task_visibility ?? "private"}</div></section>
      <div className="mt-6 flex items-center gap-3 overflow-x-auto pb-1"><div className="segmented min-w-[344px] flex-1" aria-label="Task view">{(["Today", "Upcoming", "Completed", "All"] as Filter[]).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div><label className="icon-btn shrink-0" aria-label="Filter by category"><SlidersHorizontal size={18} /><select className="sr-only" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label></div>
      {category !== "All" && <button className="btn btn-ghost mt-2" onClick={() => setCategory("All")}>Category: {category} <X size={14} /></button>}
      <div className="mt-5 space-y-3">{loading ? <div className="soft-card p-8 text-center text-muted">Loading your tasks…</div> : visible.length ? visible.map((task) => <article key={task.id} className={`card group flex items-start gap-3 p-4 transition sm:items-center ${task.status === "completed" ? "opacity-65" : "hover:-translate-y-0.5"}`}><button disabled={busyId === task.id} onClick={() => void complete(task)} className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 ${task.status === "completed" ? "border-success bg-success text-white" : "border-line-strong bg-white hover:border-brand"}`} aria-label={`${task.status === "completed" ? "Mark open" : "Complete"}: ${task.title}`}>{task.status === "completed" ? <Check size={16} strokeWidth={3} /> : <Circle size={14} className="opacity-0 group-hover:opacity-100" />}</button><div className="min-w-0 flex-1"><h2 className={`font-bold leading-5 ${task.status === "completed" ? "line-through" : ""}`}>{task.title}</h2><div className="mt-2 flex flex-wrap items-center gap-2">{task.category && <span className="badge badge-category">{task.category}</span>}<PrivacyBadge isPublic={task.visibility === "public"} /><span className="flex items-center gap-1 text-xs font-semibold text-muted"><CalendarDays size={13} /> {dueLabel(task.due_at)}</span>{task.recurrence_rule && <span className="flex items-center gap-1 text-xs font-semibold text-muted"><Repeat2 size={13} /> {task.recurrence_rule}</span>}</div></div>{task.xp_earned > 0 && <span className="badge badge-xp hidden sm:inline-flex">+{task.xp_earned} XP</span>}<button className="icon-btn h-9 w-9 border-0 bg-transparent" aria-label={`Edit ${task.title}`} onClick={() => setEditing(task)}><MoreHorizontal size={18} /></button></article>) : <div className="soft-card py-12 text-center"><Check className="mx-auto text-success" /><h2 className="display mt-5 text-xl font-bold">This corner is clear.</h2><p className="mt-2 text-sm text-muted">Nothing matches this view.</p></div>}</div>
      {justCompleted && <section className="animate-rise mt-5 rounded-[1.25rem] border-2 border-brand bg-brand-soft p-5"><div className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-white"><Sparkles size={23} /></span><div className="flex-1"><h2 className="display text-xl font-bold">Done—and {justCompleted.visibility === "public" ? "public progress is updated" : "still private"}.</h2><p className="mt-1 text-sm text-muted">Nothing was posted. Share only if it feels good.</p><div className="mt-4 flex gap-2"><Link href={`/tasks/${justCompleted.id}/share`} className="btn btn-primary">Preview post</Link><button className="btn btn-secondary" onClick={() => setJustCompleted(null)}>Not now</button></div></div></div></section>}
      <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{announcement}</p>
    </div>
    <aside className="hidden space-y-4 xl:block"><div className="rounded-[1.4rem] bg-ink p-5 text-white"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.12em] text-white/60">Today’s goal</p><Flame size={18} className="text-sun" /></div><p className="display mt-6 text-3xl font-bold">{completedToday}/{profile?.daily_goal ?? 3}</p><p className="mt-1 text-sm text-white/65">Wins logged today.</p></div><div className="card p-5"><div className="flex items-center justify-between"><h2 className="display text-lg font-bold">Public progress</h2><Globe2 size={17} className="text-community" /></div><p className="mt-2 text-sm text-muted">{publicCount} tasks visible to the community. They are not feed posts.</p></div></aside>
    {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"><form onSubmit={saveEdit} className="card w-full max-w-lg p-6"><div className="flex items-center justify-between"><h2 className="display text-2xl font-bold">Edit task</h2><button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div><label className="field-label mt-5" htmlFor="edit-title">Title</label><input className="field" id="edit-title" name="title" defaultValue={editing.title} required maxLength={160} /><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="edit-category">Category</label><input className="field" id="edit-category" name="category" defaultValue={editing.category ?? ""} maxLength={48} /></div><div><label className="field-label" htmlFor="edit-due">Due date</label><input className="field" id="edit-due" name="dueAt" type="date" defaultValue={editing.due_at?.slice(0,10) ?? ""} /></div><div><label className="field-label" htmlFor="edit-recurring">Recurrence</label><select className="field" id="edit-recurring" name="recurrenceRule" defaultValue={editing.recurrence_rule ?? ""}><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select></div><div><label className="field-label" htmlFor="edit-visibility">Visibility</label><select className="field" id="edit-visibility" name="visibility" defaultValue={editing.visibility}><option value="private">Private</option><option value="public">Public progress</option></select></div></div><div className="mt-6 flex justify-between gap-3"><button type="button" className="btn btn-danger" onClick={() => void remove(editing)}><Trash2 size={16} /> Delete</button><button className="btn btn-primary" disabled={busyId === editing.id}>Save changes</button></div></form></div>}
  </div>;
}
