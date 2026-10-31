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

// Pivot A: characters and the coach profile.

export const CHARACTER_ROLES = ["coach", "rival", "cheerleader", "deadpan"] as const;

/** A character the caller may select. The character sheet is server-only prompt material and never appears here. */
export const characterSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: z.enum(CHARACTER_ROLES),
  art_url: z.string().nullable(),
  is_launch: z.boolean(),
  pack_sku: z.string().nullable(),
});

export const characterListSchema = z.object({ items: z.array(characterSummarySchema) });

export const coachProfileSchema = z.object({
  selected_character_id: z.uuid().nullable(),
  /** IANA zone; null until onboarding saves one. */
  timezone: z.string().nullable(),
  age_verified_at: z.string().nullable(),
});

/** A field left out keeps its stored value. */
export const coachProfileUpdateSchema = z.object({
  characterId: z.uuid().optional(),
  timezone: timeZoneSchema.optional(),
}).strict().refine(
  (value) => value.characterId !== undefined || value.timezone !== undefined,
  "Choose a character or a time zone.",
);

// Pivot A: character reactions to starting and finishing a task, and splitting a task.

/** The character a reaction or split speaks as. */
export const reactionCharacterSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  artUrl: z.string().nullable(),
});

/**
 * A character's line about the task, or `crisis`: the task text suggests
 * distress, so the client shows the crisis card (988, 911) instead of any
 * banter. `disclosure` is the AI reminder on the first reaction of the local day.
 */
export const reactionPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reaction"),
    text: z.string().min(1),
    source: z.enum(["prewritten", "ai"]),
    character: reactionCharacterSchema,
    disclosure: z.string().nullable(),
  }),
  z.object({ kind: z.literal("crisis") }),
]);

/** POST /api/tasks/[id]/start. `reaction` is null when this start was already reacted to, or no character is selected. */
export const taskStartResultSchema = z.object({
  event: z.object({ id: z.uuid(), type: z.literal("started"), occurredAt: z.string() }),
  reaction: reactionPayloadSchema.nullable(),
});

/** POST /api/tasks/[id]/finish. `reaction` is null when the task was already done, nothing new was finished, or no character is selected. */
export const taskFinishResultSchema = z.object({
  task: taskSchema,
  reaction: reactionPayloadSchema.nullable(),
});

/** POST /api/tasks/[id]/split. */
export const taskSplitResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("split"),
    /** A prewritten `split_intro` line in the character's voice. */
    intro: z.string(),
    steps: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
    character: reactionCharacterSchema,
  }),
  z.object({ kind: z.literal("crisis") }),
]);

/** Error codes the split route answers with, besides the usual ones. */
export const TASK_SPLIT_ERROR_CODES = {
  /** 402: splitting is for Plus or trial users; show the paywall. */
  planRequired: "plan_required",
  /** 429: today's split cap is used up; it resets at local midnight. */
  capReached: "split_cap_reached",
  /** 503: the AI could not produce a usable split; nothing was counted against the cap. */
  unavailable: "split_unavailable",
} as const;

// Pivot A: the story, and the session nudge.

/**
 * Why a chapter is still locked. `days`: `daysNeeded` more consistency days
 * (local days with a finished task) will open it; never time in the app.
 * `plan`: the user's plan does not include it (free users read chapters 1-3;
 * Plus, a trial or the character's pack opens the whole arc).
 */
export const storyChapterLockSchema = z.discriminatedUnion("reason", [
  z.object({ reason: z.literal("days"), daysNeeded: z.number().int().min(1) }),
  z.object({ reason: z.literal("plan") }),
]);

/** One chapter in the list. A locked chapter shows its title, never its body. `lock` is null exactly when `unlocked`. */
export const storyChapterSummarySchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  unlocked: z.boolean(),
  lock: storyChapterLockSchema.nullable(),
});

/**
 * GET /api/story: the selected character's chapters, in order. `character` is
 * null (and `chapters` empty, `consistencyDays` 0) when no character is
 * selected. `consistencyDays` counts only up.
 */
export const storyOverviewSchema = z.object({
  character: reactionCharacterSchema.nullable(),
  consistencyDays: z.number().int().min(0),
  chapters: z.array(storyChapterSummarySchema),
});

/** GET /api/story/[number]: an unlocked chapter. A locked, missing or retired chapter answers 404 `not_found`. */
export const storyChapterContentSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  body: z.string(),
});

/**
 * GET /api/coach/nudge: a prewritten line suggesting the user close the app,
 * shown after 10 minutes of foreground time in one session; null when no
 * character is selected or it has no nudge lines. `disclosure` is the AI
 * reminder when this is the first character line of the user's local day,
 * as on a reaction. Rate limited (429 `rate_limited`).
 */
export const sessionNudgeSchema = z.object({
  text: z.string().min(1),
  character: reactionCharacterSchema,
  disclosure: z.string().nullable(),
}).nullable();

export type StoryChapterLock = z.infer<typeof storyChapterLockSchema>;
export type StoryChapterSummary = z.infer<typeof storyChapterSummarySchema>;
export type StoryOverview = z.infer<typeof storyOverviewSchema>;
export type StoryChapterContent = z.infer<typeof storyChapterContentSchema>;
export type SessionNudge = z.infer<typeof sessionNudgeSchema>;

export type ReactionCharacter = z.infer<typeof reactionCharacterSchema>;
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;
export type TaskStartResult = z.infer<typeof taskStartResultSchema>;
export type TaskFinishResult = z.infer<typeof taskFinishResultSchema>;
export type TaskSplitResult = z.infer<typeof taskSplitResultSchema>;

export type CharacterSummary = z.infer<typeof characterSummarySchema>;
export type CharacterList = z.infer<typeof characterListSchema>;
export type CoachProfile = z.infer<typeof coachProfileSchema>;
export type CoachProfileUpdateInput = z.infer<typeof coachProfileUpdateSchema>;

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
