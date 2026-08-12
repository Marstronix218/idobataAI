export type TaskVisibility = "private" | "public";
export type TaskStatus = "pending" | "completed";

export interface VisibilityTask {
  id: string;
  ownerId: string;
  title: string;
  category: string | null;
  visibility: TaskVisibility;
  status: TaskStatus;
  xpEarned?: number | null;
  updatedAt: string;
}

export interface VisibilityProfile {
  username: string;
  avatarUrl?: string | null;
}

export interface PublicTaskProgress {
  taskId: string;
  ownerId: string;
  username: string;
  avatarUrl: string | null;
  taskTitle: string;
  category: string | null;
  status: TaskStatus;
  xpValue: number | null;
  updatedAt: string;
}

export function toPublicProgress(
  task: VisibilityTask,
  profile: VisibilityProfile,
): PublicTaskProgress | null {
  if (task.visibility !== "public") return null;

  return {
    taskId: task.id,
    ownerId: task.ownerId,
    username: profile.username,
    avatarUrl: profile.avatarUrl ?? null,
    taskTitle: task.title,
    category: task.category,
    status: task.status,
    xpValue: task.xpEarned ?? null,
    updatedAt: task.updatedAt,
  };
}

export function taskVisibilityTransition(
  previous: TaskVisibility,
  next: TaskVisibility,
): "upsert" | "delete" | "none" {
  if (previous === next) return "none";
  return next === "public" ? "upsert" : "delete";
}
