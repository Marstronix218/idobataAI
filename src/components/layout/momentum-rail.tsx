"use client";

import Link from "next/link";
import { ArrowRight, Check, Circle, Flame, ListChecks, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { tasks as demoTasks } from "@/data/demo";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { Task, UserProfile } from "@/types";

type RailTask = Pick<Task, "id" | "title" | "due_at" | "due_has_time" | "status" | "completed_at"> & {
  previewDueLabel?: string;
};

const previewTasks: RailTask[] = demoTasks.map((task) => ({
  id: task.id,
  title: task.title,
  due_at: null,
  due_has_time: false,
  status: task.completed ? "completed" : "pending",
  completed_at: null,
  previewDueLabel: task.due,
}));

const previewProfile: Pick<UserProfile, "daily_goal" | "current_streak"> = {
  daily_goal: 3,
  current_streak: 6,
};

function isToday(value: string | null) {
  return Boolean(value && new Date(value).toDateString() === new Date().toDateString());
}

function dueTime(task: RailTask) {
  if (!task.due_at || !task.due_has_time) return "Today";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(task.due_at));
}

function dueSortTime(task: RailTask) {
  if (!task.due_at) return Number.MAX_SAFE_INTEGER;
  const due = new Date(task.due_at);
  if (!task.due_has_time) due.setHours(23, 59, 59, 999);
  return due.getTime();
}

export function MomentumRail() {
  const [tasks, setTasks] = useState<RailTask[]>(isPreviewMode ? previewTasks : []);
  const [profile, setProfile] = useState<Pick<UserProfile, "daily_goal" | "current_streak"> | null>(isPreviewMode ? previewProfile : null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest<Task[]>("/api/tasks", { signal: controller.signal }),
      apiRequest<UserProfile>("/api/profile", { signal: controller.signal }),
    ])
      .then(([loadedTasks, loadedProfile]) => { setTasks(loadedTasks); setProfile(loadedProfile); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const todayTasks = useMemo(() => tasks
    .filter((task) => task.status === "pending" && (isPreviewMode ? !["Tomorrow", "No due date"].includes(task.previewDueLabel ?? "") : isToday(task.due_at)))
    .sort((a, b) => dueSortTime(a) - dueSortTime(b))
    .slice(0, 3), [tasks]);
  const completedToday = tasks.filter((task) => task.status === "completed" && (isPreviewMode || isToday(task.completed_at)));
  const completedCount = completedToday.length;
  const dailyGoal = Math.max(1, profile?.daily_goal ?? 3);
  const progress = Math.min(100, Math.round((completedCount / dailyGoal) * 100));

  return <aside className="hidden xl:block" aria-label="Today and performance">
    <div className="sticky top-0 space-y-4 py-2">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="today-focus-heading">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div><p className="text-xs font-bold text-community">Your Tasks</p><h2 id="today-focus-heading" className="display mt-1 text-xl font-bold">Today’s tasks</h2><p className="mt-1 text-xs leading-5 text-muted">Plan and complete them in the task workspace.</p></div>
          <ListChecks size={19} className="mt-0.5 shrink-0 text-community" />
        </div>
        {loading ? <p className="px-4 py-5 text-sm text-muted">Loading today’s tasks…</p> : todayTasks.length ? <ul className="divide-y divide-line">{todayTasks.map((task) => <li key={task.id}><Link href="/tasks" aria-label={`Open ${task.title} in Your Tasks`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--hover)]"><Circle size={16} className="mt-0.5 shrink-0 text-brand" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-5">{task.title}</span><span className="mt-1 block text-xs text-muted">Due {task.previewDueLabel ?? dueTime(task)} · Open in Your Tasks</span></span></Link></li>)}</ul> : <div className="px-4 py-5 text-center"><span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-success-soft text-success"><Check size={17} /></span><p className="mt-3 text-sm font-bold">Nothing due today</p><p className="mt-1 text-xs leading-5 text-muted">Open Your Tasks to plan what comes next.</p></div>}
        <Link href="/tasks" className="flex min-h-11 items-center justify-between border-t border-line px-4 text-sm font-bold text-community transition-colors hover:bg-[var(--hover)]">Go to Your Tasks <ArrowRight size={16} /></Link>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="momentum-heading">
        <div className="flex items-center justify-between"><h2 id="momentum-heading" className="display text-xl font-bold">Your momentum</h2><Trophy size={18} className="text-sun" /></div>
        <div className="mt-4 flex items-end justify-between gap-3"><div><p className="display text-3xl font-bold">{completedCount}<span className="text-base text-muted">/{dailyGoal}</span></p><p className="mt-1 text-xs text-muted">wins today</p></div><p className="text-sm font-bold text-brand">{progress}%</p></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Daily goal progress" aria-valuemin={0} aria-valuemax={dailyGoal} aria-valuenow={Math.min(completedCount, dailyGoal)} aria-valuetext={`${completedCount} of ${dailyGoal} wins today`}><div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} /></div>
        <p className="mt-3 text-xs leading-5 text-muted">Daily goals start at 3. <Link href="/settings#preferences" aria-label="Change your daily goal in Settings" className="font-bold text-brand hover:underline">Change yours in Settings.</Link></p>
        <dl className="mt-4 grid grid-cols-2 divide-x divide-line border-t border-line pt-4 text-center">
          <div><dt className="flex items-center justify-center gap-1 text-xs text-muted"><Flame size={13} className="text-sun" /> Current streak</dt><dd className="mt-1 text-sm font-bold">{profile?.current_streak ?? 0} days</dd></div>
          <div><dt className="text-xs text-muted">Completed today</dt><dd className="mt-1 text-sm font-bold">{completedCount} task{completedCount === 1 ? "" : "s"}</dd></div>
        </dl>
      </section>

      {status && <p className="rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-5 text-muted" role="status">{status}</p>}
    </div>
  </aside>;
}
