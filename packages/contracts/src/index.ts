import { z } from "zod";

export type TaskVisibility = "private" | "public";
export type TaskStatus = "pending" | "completed";
export type TaskPriority = 1 | 2 | 3 | 4;
export const COMPLETION_COMMENT_MAX_CHARACTERS = 300;
const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const timeZoneSchema = z.string().trim().min(1).max(100).refine(isValidTimeZone, "Provide a valid IANA time zone.");

export const taskSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  due_at: z.string().nullable(),
  due_has_time: z.boolean(),
  due_timezone: timeZoneSchema.nullable(),
  recurrence_rule: z.string().nullable(),
  recurrence_instance_id: z.string().nullable(),
  priority: taskPrioritySchema.nullable(),
  visibility: z.enum(["private", "public"]),
  status: z.enum(["pending", "completed"]),
  xp_earned: z.number(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).superRefine((value, context) => {
  if (value.due_has_time && !value.due_at) {
    context.addIssue({ code: "custom", message: "A deadline time requires a due date.", path: ["due_has_time"] });
  }
  if (value.due_has_time !== Boolean(value.due_timezone)) {
    context.addIssue({ code: "custom", message: "An exact deadline requires its time zone.", path: ["due_timezone"] });
  }
});

export type Task = z.infer<typeof taskSchema>;

const clean = (max: number) => z.string().trim().min(1).max(max);
const optionalClean = (max: number) => z.string().trim().max(max).nullable().optional();

function validateDeadlineMetadata(
  value: { dueAt?: string | null; dueHasTime?: boolean; dueTimezone?: string | null },
  context: z.RefinementCtx,
) {
  if (value.dueHasTime === true && !value.dueAt) {
    context.addIssue({ code: "custom", message: "A deadline time requires a due date.", path: ["dueHasTime"] });
  }
  if (value.dueHasTime === true && !value.dueTimezone) {
    context.addIssue({ code: "custom", message: "An exact deadline requires its time zone.", path: ["dueTimezone"] });
  }
  if (value.dueHasTime !== true && value.dueTimezone != null) {
    context.addIssue({ code: "custom", message: "A time zone is only valid for an exact deadline.", path: ["dueTimezone"] });
  }
  if (value.dueTimezone !== undefined && value.dueHasTime === undefined) {
    context.addIssue({ code: "custom", message: "Deadline precision is required when changing its time zone.", path: ["dueHasTime"] });
  }
}

export const taskCreateSchema = z.object({
  title: clean(160),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  dueTimezone: timeZoneSchema.nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
}).strict().superRefine(validateDeadlineMetadata);

export const taskUpdateSchema = z.object({
  title: clean(160).optional(),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  dueTimezone: timeZoneSchema.nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["pending", "completed"]).optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.")
  .superRefine(validateDeadlineMetadata);

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
