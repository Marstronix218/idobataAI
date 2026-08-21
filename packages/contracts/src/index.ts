import { z } from "zod";

export type TaskVisibility = "private" | "public";
export type TaskStatus = "pending" | "completed";
export type TaskPriority = 1 | 2 | 3 | 4;
const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const taskSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  due_at: z.string().nullable(),
  recurrence_rule: z.string().nullable(),
  recurrence_instance_id: z.string().nullable(),
  priority: taskPrioritySchema.nullable(),
  visibility: z.enum(["private", "public"]),
  status: z.enum(["pending", "completed"]),
  xp_earned: z.number(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Task = z.infer<typeof taskSchema>;

const clean = (max: number) => z.string().trim().min(1).max(max);
const optionalClean = (max: number) => z.string().trim().max(max).nullable().optional();

export const taskCreateSchema = z.object({
  title: clean(160),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
}).strict();

export const taskUpdateSchema = z.object({
  title: clean(160).optional(),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["pending", "completed"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export interface ApiErrorBody {
  code: string;
  message: string;
  issues?: unknown;
  requestId?: string;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: ApiErrorBody;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
