import type { Task } from "@idobata/contracts";

export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function taskDueSortTime(task: Task) {
  if (!task.due_at) return Number.MAX_SAFE_INTEGER;
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return Number.MAX_SAFE_INTEGER;
  if (!task.due_has_time) due.setHours(23, 59, 59, 999);
  return due.getTime();
}

export function taskDeadlineLabel(task: Task, now: number) {
  if (!task.due_at) return "+ Set deadline";
  const date = new Date(task.due_at);
  if (Number.isNaN(date.getTime())) return "+ Set deadline";

  const dateText = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  const timeText = task.due_has_time
    ? ` · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`
    : "";
  const overdue = task.status === "pending" && taskDueSortTime(task) < now;
  return `${overdue ? "Overdue · " : ""}${dateText}${timeText}`;
}
