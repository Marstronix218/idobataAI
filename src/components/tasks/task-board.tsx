"use client";

import Link from "next/link";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Flame,
  Flag,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat2,
  SlidersHorizontal,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tasks as demoTasks } from "@/data/demo";
import { TaskCategoryManager } from "@/components/tasks/task-category-manager";
import { PrivacyBadge } from "@/components/ui/status";
import { StatusMessage } from "@/components/ui/status-message";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { useDialog } from "@/lib/client/use-dialog";
import type { Task, TaskCategory, TaskPriority, UserProfile } from "@/types";

type Filter = "Today" | "Upcoming" | "All" | "Completed";
type TaskGroup = { key: string; title: string; tasks: Task[] };

const EDIT_CATEGORIES_VALUE = "__edit_categories__";
const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: 1, label: "Priority 1 — Highest" },
  { value: 2, label: "Priority 2 — High" },
  { value: 3, label: "Priority 3 — Medium" },
  { value: 4, label: "Priority 4 — Low" },
];

function localDateInputValue(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeInputValue(value: string) {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function dueAtFromInputs(dateValue: string, timeValue: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = (timeValue || "12:00").split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const todayInputValue = () => localDateInputValue();

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
  priority: null,
  due_has_time: false,
  due_timezone: null,
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

const previewCategories: TaskCategory[] = Array.from(new Set(previewTasks.flatMap((task) => task.category ?? [])))
  .sort((left, right) => left.localeCompare(right))
  .map((name, index) => ({
    id: `preview-category-${index}`,
    owner_id: "preview",
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

function sortCategories(categories: TaskCategory[]) {
  return [...categories].sort((left, right) => left.name.localeCompare(right.name));
}

function dayBoundary(offsetDays = 0, end = false) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  value.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return value.getTime();
}

function endOfLocalDueDay(value: string) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function effectiveDueTime(task: Task) {
  if (!task.due_at) return Number.MAX_SAFE_INTEGER;
  return task.due_has_time ? new Date(task.due_at).getTime() : endOfLocalDueDay(task.due_at);
}

function isOverdue(task: Task, now: number) {
  return task.status === "pending" && Boolean(task.due_at) && effectiveDueTime(task) < now;
}

function dueLabel(task: Task, now: number) {
  if (!task.due_at) return "Anytime";
  const due = new Date(task.due_at);
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due);
  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(due);
  const dueDay = localDateInputValue(due);
  const today = localDateInputValue(new Date(now));
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateInputValue(tomorrowDate);
  const relativeDate = dueDay === today ? "Today" : dueDay === tomorrow ? "Tomorrow" : dateLabel;

  if (isOverdue(task, now)) {
    if (!task.due_has_time) return `Overdue · ${dateLabel}`;
    return dueDay === today ? `Overdue · deadline ${timeLabel}` : `Overdue · ${dateLabel} at ${timeLabel}`;
  }
  return task.due_has_time ? `${relativeDate} · deadline ${timeLabel}` : relativeDate;
}

function recurrenceLabel(value: string) {
  if (value === "weekdays") return "Weekdays";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function priorityTitle(priority: TaskPriority) {
  return priorityOptions.find((option) => option.value === priority)?.label ?? `Priority ${priority}`;
}

function groupsFor(filter: Filter, tasks: Task[], now: number): TaskGroup[] {
  if (filter === "Today") {
    return [
      { key: "overdue", title: "Overdue", tasks: tasks.filter((task) => isOverdue(task, now)) },
      { key: "today", title: "Today", tasks: tasks.filter((task) => !isOverdue(task, now)) },
    ].filter((group) => group.tasks.length);
  }
  if (filter === "All") {
    return [
      { key: "today", title: "Today", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() <= dayBoundary(0, true)) },
      { key: "upcoming", title: "Upcoming", tasks: tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() > dayBoundary(0, true)) },
      { key: "anytime", title: "Anytime", tasks: tasks.filter((task) => !task.due_at) },
    ].filter((group) => group.tasks.length);
  }
  return [{
    key: filter.toLowerCase(),
    title: filter === "Completed" ? "Completed" : "Upcoming",
    tasks,
  }].filter((group) => group.tasks.length);
}

export function TaskBoard() {
  const [items, setItems] = useState<Task[]>(isPreviewMode ? previewTasks : []);
  const [taskCategories, setTaskCategories] = useState<TaskCategory[]>(isPreviewMode ? previewCategories : []);
  const [profile, setProfile] = useState<Pick<UserProfile, "daily_goal" | "current_streak" | "default_task_visibility"> | null>(isPreviewMode ? previewProfile : null);
  const [filter, setFilter] = useState<Filter>("Today");
  const [category, setCategory] = useState("All");
  const [draft, setDraft] = useState("");
  const [quickDue, setQuickDue] = useState(todayInputValue);
  const [quickCategory, setQuickCategory] = useState("");
  const [quickRecurrence, setQuickRecurrence] = useState("");
  const [quickPriority, setQuickPriority] = useState<TaskPriority | "">("");
  const [quickDeadlineTime, setQuickDeadlineTime] = useState("");
  const [justCompleted, setJustCompleted] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editDueDate, setEditDueDate] = useState("");
  const [editDeadlineTime, setEditDeadlineTime] = useState("");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [announcementTone, setAnnouncementTone] = useState<"status" | "error">("status");
  const [editError, setEditError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const editDialogRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((message: string, tone: "status" | "error" = "status") => {
    setAnnouncement(message);
    setAnnouncementTone(tone);
  }, []);
  const closeEditor = useCallback(() => {
    setEditing(null);
    setEditDueDate("");
    setEditDeadlineTime("");
    setEditError("");
    setConfirmingDelete(false);
  }, []);
  const openEditor = useCallback((task: Task) => {
    setEditing(task);
    setEditDueDate(task.due_at ? localDateInputValue(task.due_at) : "");
    setEditDeadlineTime(task.due_at && task.due_has_time ? localTimeInputValue(task.due_at) : "");
  }, []);
  useDialog(editDialogRef, { open: Boolean(editing), onClose: closeEditor });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  async function load(signal?: AbortSignal) {
    if (isPreviewMode) return;
    setLoading(true);
    try {
      const [tasks, loadedProfile, loadedCategories] = await Promise.all([
        apiRequest<Task[]>("/api/tasks", { signal }),
        apiRequest<UserProfile>("/api/profile", { signal }),
        apiRequest<TaskCategory[]>("/api/task-categories", { signal }),
      ]);
      setItems(tasks);
      setProfile(loadedProfile);
      setTaskCategories(loadedCategories);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) notify(errorMessage(error), "error");
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
      apiRequest<TaskCategory[]>("/api/task-categories", { signal: controller.signal }),
    ])
      .then(([tasks, loadedProfile, loadedCategories]) => {
        setItems(tasks);
        setProfile(loadedProfile);
        setTaskCategories(loadedCategories);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(errorMessage(error), "error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [notify]);

  const categories = useMemo(() => [
    "All",
    ...Array.from(new Set([
      ...taskCategories.map((taskCategory) => taskCategory.name),
      ...items.flatMap((task) => task.category ?? []),
    ])).sort((left, right) => left.localeCompare(right)),
  ], [items, taskCategories]);
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
    const leftPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const left = effectiveDueTime(a);
    const right = effectiveDueTime(b);
    return left - right;
  }), [category, filter, items]);
  const groups = groupsFor(filter, visible, now);

  // Ticking a task is the most repeated interaction in the product, so it
  // applies immediately and rolls back on failure rather than freezing the
  // checkbox for a round trip. The current filter and category are deliberately
  // left alone: resetting them threw the user out of the list they were working
  // down on every single completion. The celebration card below already
  // confirms what happened and offers the optional share.
  async function complete(task: Task) {
    const next = task.status === "pending" ? "completed" : "pending";
    const optimistic = {
      ...task,
      status: next,
      completed_at: next === "completed" ? new Date().toISOString() : null,
    } as Task;
    setBusyId(task.id);
    notify("");
    setItems((current) => current.map((item) => item.id === task.id ? optimistic : item));
    setJustCompleted(next === "completed" ? optimistic : null);
    try {
      const updated = isPreviewMode
        ? optimistic
        : await apiRequest<Task>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setItems((current) => current.map((item) => item.id === task.id ? updated : item));
      setJustCompleted((current) => current?.id === task.id && next === "completed" ? updated : current);
      notify(next === "completed" ? `${task.title} completed and remains off the feed.` : `${task.title} moved back to open tasks.`);
    } catch (error) {
      setItems((current) => current.map((item) => item.id === task.id ? task : item));
      setJustCompleted((current) => current?.id === task.id ? null : current);
      notify(errorMessage(error), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function addTask(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const dueAt = dueAtFromInputs(quickDue, quickDeadlineTime);
    const dueHasTime = Boolean(dueAt && quickDeadlineTime);
    const dueTimezone = dueHasTime ? currentTimeZone() : null;
    const recurrenceRule = quickRecurrence ? quickRecurrence as "daily" | "weekdays" | "weekly" : null;
    setBusyId("new");
    notify("");
    try {
      const created = isPreviewMode
        ? {
            ...previewTasks[0],
            id: `preview-${Date.now()}`,
            title,
            category: quickCategory.trim() || null,
            due_at: dueAt,
            due_has_time: dueHasTime,
            due_timezone: dueTimezone,
            recurrence_rule: recurrenceRule,
            priority: quickPriority || null,
            visibility: profile?.default_task_visibility ?? "private",
            status: "pending",
            completed_at: null,
            xp_earned: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Task
        : await apiRequest<Task>("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
              category: quickCategory.trim() || null,
              dueAt,
              dueHasTime,
              dueTimezone,
              recurrenceRule,
              priority: quickPriority || null,
            }),
          });
      setItems((current) => [created, ...current]);
      setDraft("");
      setQuickCategory("");
      setQuickRecurrence("");
      setQuickPriority("");
      setQuickDeadlineTime("");
      notify(`${title} added ${created.visibility === "private" ? "privately" : "with public progress"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const recurrence = String(data.get("recurrenceRule"));
    const priority = String(data.get("priority"));
    const dueAt = dueAtFromInputs(editDueDate, editDeadlineTime);
    const dueHasTime = Boolean(dueAt && editDeadlineTime);
    const dueTimezone = dueHasTime ? currentTimeZone() : null;
    const patch = {
      title: String(data.get("title")),
      category: String(data.get("category")) || null,
      dueAt,
      dueHasTime,
      dueTimezone,
      recurrenceRule: recurrence ? recurrence as "daily" | "weekdays" | "weekly" : null,
      priority: priority ? Number(priority) as TaskPriority : null,
      visibility: String(data.get("visibility")) as "private" | "public",
    };
    setBusyId(editing.id);
    setEditError("");
    try {
      const updated = isPreviewMode
        ? { ...editing, title: patch.title, category: patch.category, due_at: patch.dueAt, due_has_time: patch.dueHasTime, due_timezone: patch.dueTimezone, recurrence_rule: patch.recurrenceRule, priority: patch.priority, visibility: patch.visibility }
        : await apiRequest<Task>(`/api/tasks/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setItems((current) => current.map((task) => task.id === updated.id ? updated : task));
      closeEditor();
      notify("Task changes saved.");
    } catch (error) {
      // Reported inside the dialog: the page-level status line renders beneath
      // the overlay, so a failure there was invisible and read as a dead button.
      setEditError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(task: Task) {
    setBusyId(task.id);
    setEditError("");
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/tasks/${task.id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== task.id));
      setJustCompleted((current) => current?.id === task.id ? null : current);
      closeEditor();
      notify(`${task.title} deleted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setEditError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function addCategory(name: string) {
    const cleanName = name.trim();
    if (!cleanName) return false;
    if (taskCategories.some((taskCategory) => taskCategory.name.toLowerCase() === cleanName.toLowerCase())) {
      notify(`You already have a category named ${cleanName}.`, "error");
      return false;
    }
    setCategoryBusyId("new");
    notify("");
    try {
      const now = new Date().toISOString();
      const created = isPreviewMode
        ? { id: `preview-category-${Date.now()}`, owner_id: "preview", name: cleanName, created_at: now, updated_at: now }
        : await apiRequest<TaskCategory>("/api/task-categories", { method: "POST", body: JSON.stringify({ name: cleanName }) });
      setTaskCategories((current) => sortCategories([...current, created]));
      notify(`${created.name} category added.${isPreviewMode ? " Preview only." : ""}`);
      return true;
    } catch (error) {
      notify(errorMessage(error), "error");
      return false;
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function renameCategory(taskCategory: TaskCategory, name: string) {
    const cleanName = name.trim();
    if (!cleanName) return false;
    if (taskCategory.name === cleanName) return true;
    if (taskCategories.some((candidate) => candidate.id !== taskCategory.id && candidate.name.toLowerCase() === cleanName.toLowerCase())) {
      notify(`You already have a category named ${cleanName}.`, "error");
      return false;
    }
    setCategoryBusyId(taskCategory.id);
    notify("");
    try {
      const updated = isPreviewMode
        ? { ...taskCategory, name: cleanName, updated_at: new Date().toISOString() }
        : await apiRequest<TaskCategory>(`/api/task-categories/${taskCategory.id}`, { method: "PATCH", body: JSON.stringify({ name: cleanName }) });
      setTaskCategories((current) => sortCategories(current.map((candidate) => candidate.id === updated.id ? updated : candidate)));
      setItems((current) => current.map((task) => task.category?.toLowerCase() === taskCategory.name.toLowerCase() ? { ...task, category: updated.name } : task));
      setCategory((current) => current.toLowerCase() === taskCategory.name.toLowerCase() ? updated.name : current);
      setQuickCategory((current) => current.toLowerCase() === taskCategory.name.toLowerCase() ? updated.name : current);
      setEditing((current) => current?.category?.toLowerCase() === taskCategory.name.toLowerCase() ? { ...current, category: updated.name } : current);
      notify(`${taskCategory.name} renamed to ${updated.name}.${isPreviewMode ? " Preview only." : ""}`);
      return true;
    } catch (error) {
      notify(errorMessage(error), "error");
      return false;
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function deleteCategory(taskCategory: TaskCategory) {
    const affectedTasks = items.filter((task) => task.category?.toLowerCase() === taskCategory.name.toLowerCase()).length;
    setCategoryBusyId(taskCategory.id);
    notify("");
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/task-categories/${taskCategory.id}`, { method: "DELETE" });
      setTaskCategories((current) => current.filter((candidate) => candidate.id !== taskCategory.id));
      setItems((current) => current.map((task) => task.category?.toLowerCase() === taskCategory.name.toLowerCase() ? { ...task, category: null } : task));
      setCategory((current) => current.toLowerCase() === taskCategory.name.toLowerCase() ? "All" : current);
      setQuickCategory((current) => current.toLowerCase() === taskCategory.name.toLowerCase() ? "" : current);
      setEditing((current) => current?.category?.toLowerCase() === taskCategory.name.toLowerCase() ? { ...current, category: null } : current);
      notify(`${taskCategory.name} deleted and cleared from ${affectedTasks} current ${affectedTasks === 1 ? "task" : "tasks"}.${isPreviewMode ? " Preview only." : ""}`);
      return true;
    } catch (error) {
      notify(errorMessage(error), "error");
      return false;
    } finally {
      setCategoryBusyId(null);
    }
  }

  return <>
    <div className="min-w-0">
      {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Tasks use demo data and reset when you reload.</div>}

      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-brand">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
          <h1 className="page-title mt-1">Your Tasks</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-32 rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs font-bold text-muted"><span>Today</span><span>{completedToday}/{dailyGoal}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Daily task goal" aria-valuemin={0} aria-valuemax={dailyGoal} aria-valuenow={Math.min(completedToday, dailyGoal)} aria-valuetext={`${completedToday} of ${dailyGoal} tasks completed today`}><div className="h-full rounded-full bg-success" style={{ width: `${dailyProgress}%` }} /></div>
          </div>
          <div
            aria-label={`${profile?.current_streak ?? 0}-day streak. A streak counts consecutive days with at least one completed task.`}
            className="flex min-h-[58px] items-center gap-2 rounded-2xl border border-line bg-surface px-4"
            title="A streak counts consecutive days with at least one completed task."
          ><Flame size={18} className="text-sun" /><div><p className="text-lg font-bold leading-none">{profile?.current_streak ?? 0}</p><p className="mt-1 text-xs text-muted">day streak</p></div></div>
          <button className="icon-btn" aria-label="Refresh tasks" onClick={() => void load()} disabled={loading}><RefreshCw size={19} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>

      <form className="card mt-7 overflow-hidden border-brand/25" onSubmit={(event) => void addTask(event)}>
        <div className="flex gap-3 p-3 sm:p-4">
          <label htmlFor="quick-task" className="sr-only">Add a task</label>
          <input id="quick-task" value={draft} onChange={(event) => setDraft(event.target.value)} className="field min-w-0 flex-1 border-0 bg-transparent text-base shadow-none" placeholder="Add a task…" maxLength={160} />
          <button className="btn btn-primary shrink-0 px-4" disabled={busyId === "new" || !draft.trim()}><Plus size={18} /><span className="hidden sm:inline">Add task</span></button>
        </div>
        <div className="grid gap-2 border-t border-line bg-canvas/55 p-3 sm:grid-cols-2 sm:items-center sm:px-4 lg:grid-cols-3 xl:grid-cols-[155px_minmax(145px,1fr)_175px_190px_165px]">
          <label><span className="sr-only">Due date</span><input type="date" className="field min-h-10 py-2 text-xs font-bold" value={quickDue} onChange={(event) => { const value = event.target.value; setQuickDue(value); if (!value) setQuickDeadlineTime(""); }} /></label>
          <div className="relative min-w-0"><label className="sr-only" htmlFor="quick-deadline-time">Deadline time (optional)</label><Clock aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input id="quick-deadline-time" type="time" className={`field field-prefixed min-h-10 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${quickDeadlineTime ? "field-suffixed" : ""}`} value={quickDeadlineTime} onChange={(event) => setQuickDeadlineTime(event.target.value)} disabled={!quickDue} />{quickDeadlineTime && <button type="button" aria-label="Clear deadline time for new task" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink" onClick={() => setQuickDeadlineTime("")}><X aria-hidden="true" size={15} /></button>}</div>
          <label className="relative min-w-0"><span className="sr-only">Category (optional)</span><Tag aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field field-prefixed field-suffixed min-h-10 appearance-none py-2 text-xs font-bold" value={quickCategory} onChange={(event) => { const value = event.target.value; if (value === EDIT_CATEGORIES_VALUE) { setAnnouncement(""); setCategoryManagerOpen(true); return; } setQuickCategory(value); }}><option value="">No category</option>{taskCategories.map((taskCategory) => <option key={taskCategory.id} value={taskCategory.name}>{taskCategory.name}</option>)}<option value={EDIT_CATEGORIES_VALUE}>Edit categories…</option></select><ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" /></label>
          <label className="relative min-w-0"><span className="sr-only">Repeat schedule</span><Repeat2 aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field field-prefixed field-suffixed min-h-10 appearance-none py-2 text-xs font-bold" value={quickRecurrence} onChange={(event) => setQuickRecurrence(event.target.value)}><option value="">Doesn’t repeat</option><option value="daily">Daily routine</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly chore</option></select><ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" /></label>
          <label className="relative min-w-0"><span className="sr-only">Priority (optional)</span><Flag aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field field-prefixed field-suffixed min-h-10 appearance-none py-2 text-xs font-bold" value={quickPriority} onChange={(event) => { const value = event.target.value; setQuickPriority(value ? Number(value) as TaskPriority : ""); }}><option value="">No priority</option>{priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" /></label>
          <span className="flex items-center gap-1.5 px-1 text-xs font-bold text-muted sm:col-span-2 lg:col-span-3 xl:col-span-5"><LockKeyhole size={13} /> Starts {profile?.default_task_visibility ?? "private"}</span>
        </div>
      </form>

      {/* First run lands here straight from onboarding. Neither the old feed
          landing nor the bare "Today is clear." empty state explained the
          ritual the product is actually built around, so the loop is taught
          once, at the moment the user has nothing yet. */}
      {!loading && !items.length && <section className="mt-6 rounded-[1.25rem] border border-brand/30 bg-brand-soft/50 p-5" aria-labelledby="first-run-title">
        <p className="text-xs font-bold uppercase tracking-[.1em] text-brand">How this works</p>
        <h2 id="first-run-title" className="display mt-1 text-xl font-bold">Start with one small thing.</h2>
        <ol className="mt-4 space-y-3">
          <li className="flex gap-3 text-sm leading-6"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">1</span><span><strong>Add it privately.</strong> Every task starts private. Nobody else can see it.</span></li>
          <li className="flex gap-3 text-sm leading-6"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">2</span><span><strong>Finish it.</strong> Completing a task never posts anything, anywhere.</span></li>
          <li className="flex gap-3 text-sm leading-6"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">3</span><span><strong>Share only if you want to.</strong> Posting the win is a separate, deliberate choice.</span></li>
        </ol>
      </section>}

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="segmented min-w-0 flex-1 overflow-x-auto" aria-label="Task view">
          {(["Today", "Upcoming", "All", "Completed"] as Filter[]).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{value}</span><span className="ml-1 text-xs opacity-65">{counts[value]}</span></button>)}
        </div>
        <label className="relative min-w-44"><span className="sr-only">Filter by category</span><SlidersHorizontal aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><select className="field field-prefixed field-suffixed min-h-12 appearance-none py-2 text-sm font-bold" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value} value={value}>{value === "All" ? "All categories" : value}</option>)}</select><ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" /></label>
      </div>

      {justCompleted && <section aria-labelledby={`completed-${justCompleted.id}`} className="animate-rise mt-5 rounded-[1.25rem] border border-success/45 bg-success-soft p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success text-canvas"><Check aria-hidden="true" size={19} strokeWidth={3} /></span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-success">Done</p><h2 id={`completed-${justCompleted.id}`} className="display mt-0.5 text-lg font-bold">{justCompleted.title}</h2><p className="mt-1 text-sm text-muted">It stays off the feed unless you share it.</p><div className="mt-3 flex flex-wrap gap-2"><Link href={`/tasks/${justCompleted.id}/share`} className="btn btn-secondary">Share</Link><button className="btn btn-ghost" onClick={() => void complete(justCompleted)} disabled={busyId === justCompleted.id}><Undo2 aria-hidden="true" size={16} /> Undo</button></div></div><button type="button" className="icon-btn h-11 w-11 shrink-0 border-0 bg-transparent" onClick={() => { setJustCompleted(null); notify(""); }} aria-label="Dismiss completion message"><X aria-hidden="true" size={18} /></button></div></section>}

      <section className="card mt-5 overflow-hidden" aria-label={`${filter} tasks`}>
        {loading ? (
          <div className="p-10 text-center text-muted">Loading your tasks…</div>
        ) : groups.length ? (
          groups.map((group) => (
            <div key={group.key} className="border-b border-line last:border-b-0">
              <div className="flex items-baseline justify-between gap-4 bg-surface-raised/45 px-4 py-3 sm:px-5">
                <h2 className="display text-lg font-bold">{group.title}</h2>
                <p className="text-xs font-semibold text-muted">{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</p>
              </div>
              <div className="divide-y divide-line">
                {group.tasks.map((task) => (
                  <article key={task.id} className="group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-[var(--hover)] sm:items-center sm:px-5">
                    <button disabled={busyId === task.id} onClick={() => void complete(task)} className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition sm:mt-0 ${task.status === "completed" ? "border-success bg-success text-canvas" : "border-line-strong bg-surface-raised hover:border-success"}`} aria-label={`${task.status === "completed" ? "Mark open" : "Complete"}: ${task.title}`}>
                      {task.status === "completed" ? <Check size={15} strokeWidth={3} /> : <Circle size={12} className="opacity-0 group-hover:opacity-100" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <h3 className={`font-bold leading-5 ${task.status === "completed" ? "text-muted line-through" : ""}`}>{task.title}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                        {task.priority && <span className="badge badge-priority" title={priorityTitle(task.priority)}>Priority {task.priority}</span>}
                        {task.category && <span className="badge badge-category">{task.category}</span>}
                        <PrivacyBadge isPublic={task.visibility === "public"} />
                        <span className={`flex items-center gap-1 text-xs font-semibold ${isOverdue(task, now) ? "text-danger" : "text-muted"}`}>{task.due_has_time ? <Clock aria-hidden="true" size={13} /> : <CalendarDays aria-hidden="true" size={13} />} {task.due_at ? <time dateTime={task.due_at}>{dueLabel(task, now)}</time> : "Anytime"}</span>
                        {task.recurrence_rule && <span className="flex items-center gap-1 text-xs font-semibold text-muted"><Repeat2 aria-hidden="true" size={13} /> {recurrenceLabel(task.recurrence_rule)}</span>}
                      </div>
                    </div>
                    {task.status === "completed" && <Link href={`/tasks/${task.id}/share`} className="btn btn-ghost min-h-9 shrink-0 px-3 py-2 text-xs text-brand">Post</Link>}
                    <button className="icon-btn h-9 w-9 shrink-0 border-0 bg-transparent" aria-label={`Edit ${task.title}`} onClick={() => openEditor(task)}><MoreHorizontal size={18} /></button>
                  </article>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success"><Check size={20} /></span><h2 className="display mt-5 text-xl font-bold">{filter === "Today" ? "Today is clear." : "Nothing here yet."}</h2><p className="mt-2 text-sm text-muted">{category === "All" ? "Add a task or choose another view." : `No ${category} tasks match this view.`}</p></div>
        )}
      </section>
      <StatusMessage message={categoryManagerOpen ? "" : announcement} tone={categoryManagerOpen ? "status" : announcementTone} className={justCompleted ? "sr-only" : ""} onRetry={announcementTone === "error" && !categoryManagerOpen ? () => void load() : undefined} />
    </div>

    {editing && <div ref={editDialogRef} className="fixed inset-0 z-50 grid place-items-end bg-overlay/70 p-0 sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== editing.id) closeEditor(); }}>
      {/* Scroll container: without it the form is taller than a 360x640 viewport
          with the keyboard open, and Save is unreachable. */}
      <form onSubmit={saveEdit} role="dialog" aria-modal="true" aria-labelledby="edit-task-title" className="card flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.5rem] p-0 sm:rounded-[1.5rem]">
        <div className="flex items-center justify-between gap-4 border-b border-line p-5 sm:p-6">
          <div><p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Task details</p><h2 id="edit-task-title" className="display mt-1 text-2xl font-bold">Edit task</h2></div>
          <button type="button" className="icon-btn shrink-0" onClick={closeEditor} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <label className="field-label" htmlFor="edit-title">Title</label>
        <input className="field" id="edit-title" name="title" defaultValue={editing.title} required maxLength={160} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="edit-category">Category <span className="font-medium normal-case tracking-normal text-muted">(optional)</span></label>
            <div className="relative">
              <select key={`${editing.id}-${editing.category ?? "none"}`} className="field field-suffixed appearance-none" id="edit-category" name="category" defaultValue={editing.category ?? ""} onChange={(event) => { if (event.target.value !== EDIT_CATEGORIES_VALUE) return; event.currentTarget.value = editing.category ?? ""; setAnnouncement(""); setCategoryManagerOpen(true); }}>
                <option value="">No category</option>
                {editing.category && !taskCategories.some((taskCategory) => taskCategory.name === editing.category) && <option value={editing.category}>{editing.category}</option>}
                {taskCategories.map((taskCategory) => <option key={taskCategory.id} value={taskCategory.name}>{taskCategory.name}</option>)}
                <option value={EDIT_CATEGORIES_VALUE}>Edit categories…</option>
              </select>
              <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          </div>
          <div><label className="field-label" htmlFor="edit-due">Due date</label><input className="field" id="edit-due" name="dueAt" type="date" value={editDueDate} onChange={(event) => { const value = event.target.value; setEditDueDate(value); if (!value) setEditDeadlineTime(""); }} /></div>
          <div><label className="field-label" htmlFor="edit-deadline-time">Deadline time <span className="font-medium normal-case tracking-normal text-muted">(optional)</span></label><div className="relative"><input className={`field disabled:cursor-not-allowed disabled:opacity-60 ${editDeadlineTime ? "field-suffixed" : ""}`} id="edit-deadline-time" name="deadlineTime" type="time" value={editDeadlineTime} onChange={(event) => setEditDeadlineTime(event.target.value)} disabled={!editDueDate} />{editDeadlineTime && <button type="button" aria-label="Clear deadline time" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink" onClick={() => setEditDeadlineTime("")}><X aria-hidden="true" size={15} /></button>}</div></div>
          <div>
            <label className="field-label" htmlFor="edit-priority">Priority <span className="font-medium normal-case tracking-normal text-muted">(optional)</span></label>
            <div className="relative">
              <select className="field field-suffixed appearance-none" id="edit-priority" name="priority" defaultValue={editing.priority ?? ""}><option value="">No priority</option>{priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="edit-recurring">Repeat</label>
            <div className="relative">
              <select className="field field-suffixed appearance-none" id="edit-recurring" name="recurrenceRule" defaultValue={editing.recurrence_rule ?? ""}><option value="">Does not repeat</option><option value="daily">Daily routine</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly chore</option></select>
              <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="edit-visibility">Visibility</label>
            <div className="relative">
              <select className="field field-suffixed appearance-none" id="edit-visibility" name="visibility" defaultValue={editing.visibility}><option value="private">Private</option><option value="public">Public progress</option></select>
              <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">Leave the time blank when the task can be finished any time that day. Posting remains a separate choice after completion.</p>
        {editError && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger"><span className="min-w-0 flex-1 break-words">{editError}</span></div>}
        </div>
        {/* Deleting a task is irreversible, so it confirms in place rather than
            firing on a single click, matching the category editor. */}
        <div className="border-t border-line p-5 sm:p-6">
          {confirmingDelete ? (
            <div role="alert" className="rounded-xl bg-danger-soft p-3">
              <p className="font-bold break-words">Delete “{editing.title}”?</p>
              <p className="mt-1 text-sm leading-6 text-muted">This cannot be undone. Anything you already posted about it stays as it is.</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn btn-secondary min-h-11" onClick={() => setConfirmingDelete(false)} disabled={busyId === editing.id}>Keep task</button>
                <button type="button" className="btn btn-danger min-h-11" onClick={() => void remove(editing)} disabled={busyId === editing.id}><Trash2 size={16} /> Delete task</button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between gap-3"><button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)} disabled={busyId === editing.id}><Trash2 size={16} /> Delete</button><button className="btn btn-primary" disabled={busyId === editing.id}>Save changes</button></div>
          )}
        </div>
      </form>
    </div>}

    {categoryManagerOpen && <TaskCategoryManager categories={taskCategories} taskCount={(name) => items.filter((task) => task.category?.toLowerCase() === name.toLowerCase()).length} busyId={categoryBusyId} status={announcement} onAdd={addCategory} onRename={renameCategory} onDelete={deleteCategory} onClose={() => { setCategoryManagerOpen(false); setAnnouncement(""); }} />}
  </>;
}
