"use client";

import Link from "next/link";
import {
  CalendarDays,
  Check,
  Circle,
  Flame,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { tasks as demoTasks } from "@/data/demo";
import { PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { Task, UserProfile } from "@/types";

type Filter = "Today" | "Upcoming" | "All" | "Completed";
type TaskGroup = { key: string; title: string; hint: string; tasks: Task[] };

const todayInputValue = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const previewTasks: Task[] = demoTasks.map((task, index) => ({
  id: task.id,
  owner_id: "preview",
  title: task.title,
  description: null,
  category: task.category,
  due_at: task.due === "Today"
    ? new Date().toISOString()
    : task.due === "Tomorrow"
      ? new Date(Date.now() + 86_400_000).toISOString()
      : null,
  recurrence_rule: task.recurring ? "weekdays" : null,
  recurrence_instance_id: null,
  visibility: task.isPublic ? "public" : "private",
  status: task.completed ? "completed" : "pending",
  xp_earned: task.xp,
  completed_at: task.completed ? new Date().toISOString() : null,
  created_at: new Date(Date.now() - index * 1000).toISOString(),
  updated_at: new Date().toISOString(),
}));

const previewProfile = {
  daily_goal: 3,
  current_streak: 6,
  default_task_visibility: "private",
} satisfies Pick<UserProfile, "daily_goal" | "current_streak" | "default_task_visibility">;

function dayBoundary(offsetDays = 0, end = false) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  value.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return value.getTime();
}

function dueLabel(value: string | null) {
  if (!value) return "Anytime";
  const time = new Date(value).getTime();
  if (time < dayBoundary()) return "Overdue";
  if (time <= dayBoundary(0, true)) return "Today";
  if (time <= dayBoundary(1, true)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function recurrenceLabel(value: string) {
  if (value === "weekdays") return "Weekdays";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function groupsFor(filter: Filter, tasks: Task[]): TaskGroup[] {
  if (filter === "Today") {
    return [
      { key: "overdue", title: "Overdue", hint: "Still worth doing", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < dayBoundary()) },
      { key: "today", title: "Today", hint: "Your next clear steps", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() >= dayBoundary()) },
    ].filter((group) => group.tasks.length);
  }
  if (filter === "All") {
    return [
      { key: "today", title: "Today", hint: "Due now", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() <= dayBoundary(0, true)) },
      { key: "upcoming", title: "Upcoming", hint: "Planned ahead", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() > dayBoundary(0, true)) },
      { key: "anytime", title: "Anytime", hint: "No date yet", tasks: tasks.filter((task) => !task.due_at) },
    ].filter((group) => group.tasks.length);
  }
  return [{
    key: filter.toLowerCase(),
    title: filter === "Completed" ? "Completed" : "Upcoming",
    hint: filter === "Completed" ? "Ready to revisit or post" : "What is coming next",
    tasks,
  }].filter((group) => group.tasks.length);
}

export function TaskBoard() {
  const [items, setItems] = useState<Task[]>(isPreviewMode ? previewTasks : []);
  const [profile, setProfile] = useState<Pick<UserProfile, "daily_goal" | "current_streak" | "default_task_visibility"> | null>(isPreviewMode ? previewProfile : null);
  const [filter, setFilter] = useState<Filter>("Today");
  const [category, setCategory] = useState("All");
  const [draft, setDraft] = useState("");
  const [quickDue, setQuickDue] = useState(todayInputValue);
  const [quickCategory, setQuickCategory] = useState("");
  const [quickRecurrence, setQuickRecurrence] = useState("");
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
      setItems(tasks);
      setProfile(loadedProfile);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setAnnouncement(errorMessage(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest<Task[]>("/api/tasks", { signal: controller.signal }),
      apiRequest<UserProfile>("/api/profile", { signal: controller.signal }),
    ])
      .then(([tasks, loadedProfile]) => {
        setItems(tasks);
        setProfile(loadedProfile);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAnnouncement(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((task) => task.category).filter(Boolean) as string[]))],
    [items],
  );
  const counts = useMemo(() => ({
    Today: items.filter((task) => task.status === "pending" && task.due_at && new Date(task.due_at).getTime() <= dayBoundary(0, true)).length,
    Upcoming: items.filter((task) => task.status === "pending" && task.due_at && new Date(task.due_at).getTime() > dayBoundary(0, true)).length,
    All: items.filter((task) => task.status === "pending").length,
    Completed: items.filter((task) => task.status === "completed").length,
  }), [items]);
  const completedToday = items.filter((task) => task.status === "completed" && task.completed_at && new Date(task.completed_at).getTime() >= dayBoundary()).length;
  const dailyGoal = Math.max(1, profile?.daily_goal ?? 3);
  const dailyProgress = Math.min(100, Math.round((completedToday / dailyGoal) * 100));

  const visible = useMemo(() => items.filter((task) => {
    const dueTime = task.due_at ? new Date(task.due_at).getTime() : null;
    const statusMatch = filter === "Completed"
      ? task.status === "completed"
      : filter === "All"
        ? task.status === "pending"
        : filter === "Today"
          ? task.status === "pending" && dueTime !== null && dueTime <= dayBoundary(0, true)
          : task.status === "pending" && dueTime !== null && dueTime > dayBoundary(0, true);
    return statusMatch && (category === "All" || task.category === category);
  }).sort((a, b) => {
    const left = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const right = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    return left - right;
  }), [category, filter, items]);
  const groups = groupsFor(filter, visible);

  async function complete(task: Task) {
    const next = task.status === "pending" ? "completed" : "pending";
    setBusyId(task.id);
    setAnnouncement("");
    try {
      const updated = isPreviewMode
        ? { ...task, status: next, completed_at: next === "completed" ? new Date().toISOString() : null } as Task
        : await apiRequest<Task>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setItems((current) => current.map((item) => item.id === task.id ? updated : item));
      setJustCompleted(next === "completed" ? updated : null);
      setAnnouncement(next === "completed" ? `${task.title} completed. Nothing was posted.` : `${task.title} moved back to open tasks.`);
    } catch (error) {
      setAnnouncement(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function addTask(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const dueAt = quickDue ? new Date(`${quickDue}T12:00:00`).toISOString() : null;
    const recurrenceRule = quickRecurrence ? quickRecurrence as "daily" | "weekdays" | "weekly" : null;
    setBusyId("new");
    setAnnouncement("");
    try {
      const created = isPreviewMode
        ? {
            ...previewTasks[0],
            id: `preview-${Date.now()}`,
            title,
            category: quickCategory.trim() || null,
            due_at: dueAt,
            recurrence_rule: recurrenceRule,
            visibility: profile?.default_task_visibility ?? "private",
            status: "pending",
            completed_at: null,
            xp_earned: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Task
        : await apiRequest<Task>("/api/tasks", {
            method: "POST",
            body: JSON.stringify({ title, category: quickCategory.trim() || null, dueAt, recurrenceRule }),
          });
      setItems((current) => [created, ...current]);
      setDraft("");
      setQuickCategory("");
      setQuickRecurrence("");
      setAnnouncement(`${title} added ${created.visibility === "private" ? "privately" : "with public progress"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setAnnouncement(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const recurrence = String(data.get("recurrenceRule"));
    const patch = {
      title: String(data.get("title")),
      category: String(data.get("category")) || null,
      dueAt: data.get("dueAt") ? new Date(`${data.get("dueAt")}T12:00:00`).toISOString() : null,
      recurrenceRule: recurrence ? recurrence as "daily" | "weekdays" | "weekly" : null,
      visibility: String(data.get("visibility")) as "private" | "public",
    };
    setBusyId(editing.id);
    try {
      const updated = isPreviewMode
        ? { ...editing, title: patch.title, category: patch.category, due_at: patch.dueAt, recurrence_rule: patch.recurrenceRule, visibility: patch.visibility }
        : await apiRequest<Task>(`/api/tasks/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setItems((current) => current.map((task) => task.id === updated.id ? updated : task));
      setEditing(null);
      setAnnouncement("Task changes saved.");
    } catch (error) {
      setAnnouncement(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(task: Task) {
    setBusyId(task.id);
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/tasks/${task.id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== task.id));
      setEditing(null);
      setAnnouncement(`${task.title} deleted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setAnnouncement(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return <>
    <div className="min-w-0">
      {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Tasks use demo data and reset when you reload.</div>}

      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-brand">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
          <h1 className="page-title mt-1">Your Tasks</h1>
          <p className="mt-2 text-muted">Plan what matters, then leave the rest for later.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-32 rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs font-bold text-muted"><span>Today</span><span>{completedToday}/{dailyGoal}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Daily task goal" aria-valuemin={0} aria-valuemax={dailyGoal} aria-valuenow={Math.min(completedToday, dailyGoal)} aria-valuetext={`${completedToday} of ${dailyGoal} tasks completed today`}><div className="h-full rounded-full bg-success" style={{ width: `${dailyProgress}%` }} /></div>
          </div>
          <div className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-line bg-surface px-4"><Flame size={18} className="text-sun" /><div><p className="text-lg font-bold leading-none">{profile?.current_streak ?? 0}</p><p className="mt-1 text-xs text-muted">day streak</p></div></div>
          <button className="icon-btn" aria-label="Refresh tasks" onClick={() => void load()} disabled={loading}><RefreshCw size={19} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>

      <form className="card mt-7 overflow-hidden border-brand/25" onSubmit={(event) => void addTask(event)}>
        <div className="flex gap-3 p-3 sm:p-4">
          <label htmlFor="quick-task" className="sr-only">Add a task</label>
          <input id="quick-task" value={draft} onChange={(event) => setDraft(event.target.value)} className="field min-w-0 flex-1 border-0 bg-transparent text-base shadow-none" placeholder="Add a task…" maxLength={160} />
          <button className="btn btn-primary shrink-0 px-4" disabled={busyId === "new" || !draft.trim()}><Plus size={18} /><span className="hidden sm:inline">Add task</span></button>
        </div>
        <div className="grid gap-2 border-t border-line bg-canvas/55 p-3 sm:grid-cols-[150px_minmax(140px,1fr)_150px_auto] sm:items-center sm:px-4">
          <label className="relative"><span className="sr-only">Due date</span><CalendarDays aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input type="date" className="field min-h-10 py-2 pl-9 text-xs font-bold" value={quickDue} onChange={(event) => setQuickDue(event.target.value)} /></label>
          <label><span className="sr-only">Category</span><input list="task-categories" className="field min-h-10 py-2 text-xs font-bold" placeholder="List or category" value={quickCategory} onChange={(event) => setQuickCategory(event.target.value)} maxLength={48} /><datalist id="task-categories">{categories.filter((value) => value !== "All").map((value) => <option key={value} value={value} />)}</datalist></label>
          <label className="relative"><span className="sr-only">Repeat schedule</span><Repeat2 aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field min-h-10 appearance-none py-2 pl-9 pr-8 text-xs font-bold" value={quickRecurrence} onChange={(event) => setQuickRecurrence(event.target.value)}><option value="">Doesn’t repeat</option><option value="daily">Daily routine</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly chore</option></select></label>
          <span className="flex items-center gap-1.5 px-1 text-xs font-bold text-muted"><LockKeyhole size={13} /> Starts {profile?.default_task_visibility ?? "private"}</span>
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="segmented min-w-0 flex-1 overflow-x-auto" aria-label="Task view">
          {(["Today", "Upcoming", "All", "Completed"] as Filter[]).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{value}</span><span className="ml-1 text-xs opacity-65">{counts[value]}</span></button>)}
        </div>
        <label className="relative min-w-44"><span className="sr-only">Filter by category</span><SlidersHorizontal aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field min-h-12 appearance-none py-2 pl-9 pr-8 text-sm font-bold" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value} value={value}>{value === "All" ? "All categories" : value}</option>)}</select></label>
      </div>

      {justCompleted && <section className="animate-rise mt-5 rounded-[1.25rem] border border-success/45 bg-success-soft p-5"><div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-success text-canvas"><Sparkles size={21} /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.1em] text-success">Task complete</p><h2 className="display mt-1 text-xl font-bold">{justCompleted.title}</h2><p className="mt-1 text-sm text-muted">Nothing was posted. Add a note or photos only if you want to share this win.</p><div className="mt-4 flex flex-wrap gap-2"><Link href={`/tasks/${justCompleted.id}/share`} className="btn btn-primary">Post a win</Link><button className="btn btn-secondary" onClick={() => void complete(justCompleted)} disabled={busyId === justCompleted.id}><Undo2 size={16} /> Undo</button><button className="btn btn-ghost" onClick={() => setJustCompleted(null)}>Not now</button></div></div></div></section>}

      <section className="card mt-5 overflow-hidden" aria-label={`${filter} tasks`}>
        {loading ? <div className="p-10 text-center text-muted">Loading your tasks…</div> : groups.length ? groups.map((group) => <div key={group.key} className="border-b border-line last:border-b-0"><div className="flex items-baseline justify-between gap-4 bg-surface-raised/45 px-4 py-3 sm:px-5"><h2 className="display text-lg font-bold">{group.title}</h2><p className="text-xs font-semibold text-muted">{group.hint} · {group.tasks.length}</p></div><div className="divide-y divide-line">{group.tasks.map((task) => <article key={task.id} className="group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-[var(--hover)] sm:items-center sm:px-5"><button disabled={busyId === task.id} onClick={() => void complete(task)} className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition sm:mt-0 ${task.status === "completed" ? "border-success bg-success text-canvas" : "border-line-strong bg-surface-raised hover:border-success"}`} aria-label={`${task.status === "completed" ? "Mark open" : "Complete"}: ${task.title}`}>{task.status === "completed" ? <Check size={15} strokeWidth={3} /> : <Circle size={12} className="opacity-0 group-hover:opacity-100" />}</button><div className="min-w-0 flex-1"><h3 className={`font-bold leading-5 ${task.status === "completed" ? "text-muted line-through" : ""}`}>{task.title}</h3><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">{task.category && <span className="badge badge-category">{task.category}</span>}<PrivacyBadge isPublic={task.visibility === "public"} /><span className={`flex items-center gap-1 text-xs font-semibold ${dueLabel(task.due_at) === "Overdue" ? "text-danger" : "text-muted"}`}><CalendarDays size={13} /> {dueLabel(task.due_at)}</span>{task.recurrence_rule && <span className="flex items-center gap-1 text-xs font-semibold text-muted"><Repeat2 size={13} /> {recurrenceLabel(task.recurrence_rule)}</span>}</div></div>{task.status === "completed" && <Link href={`/tasks/${task.id}/share`} className="btn btn-ghost min-h-9 shrink-0 px-3 py-2 text-xs text-brand">Post a win</Link>}<button className="icon-btn h-9 w-9 shrink-0 border-0 bg-transparent" aria-label={`Edit ${task.title}`} onClick={() => setEditing(task)}><MoreHorizontal size={18} /></button></article>)}</div></div>) : <div className="py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success"><Check size={20} /></span><h2 className="display mt-5 text-xl font-bold">{filter === "Today" ? "Today is clear." : "Nothing here yet."}</h2><p className="mt-2 text-sm text-muted">{category === "All" ? "Add a task or choose another view." : `No ${category} tasks match this view.`}</p></div>}
      </section>
      <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{announcement}</p>
    </div>

    {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-overlay/70 p-4"><form onSubmit={saveEdit} className="card w-full max-w-lg p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Task details</p><h2 className="display mt-1 text-2xl font-bold">Edit task</h2></div><button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div><label className="field-label mt-5" htmlFor="edit-title">Title</label><input className="field" id="edit-title" name="title" defaultValue={editing.title} required maxLength={160} /><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="edit-category">Category</label><input className="field" id="edit-category" name="category" defaultValue={editing.category ?? ""} maxLength={48} /></div><div><label className="field-label" htmlFor="edit-due">Due date</label><input className="field" id="edit-due" name="dueAt" type="date" defaultValue={editing.due_at?.slice(0, 10) ?? ""} /></div><div><label className="field-label" htmlFor="edit-recurring">Repeat</label><select className="field" id="edit-recurring" name="recurrenceRule" defaultValue={editing.recurrence_rule ?? ""}><option value="">Does not repeat</option><option value="daily">Daily routine</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly chore</option></select></div><div><label className="field-label" htmlFor="edit-visibility">Visibility</label><select className="field" id="edit-visibility" name="visibility" defaultValue={editing.visibility}><option value="private">Private</option><option value="public">Public progress</option></select></div></div><p className="mt-4 text-xs leading-5 text-muted">Repeating tasks work well for chores and routines. Posting remains a separate choice after completion.</p><div className="mt-6 flex justify-between gap-3"><button type="button" className="btn btn-danger" onClick={() => void remove(editing)}><Trash2 size={16} /> Delete</button><button className="btn btn-primary" disabled={busyId === editing.id}>Save changes</button></div></form></div>}
  </>;
}
