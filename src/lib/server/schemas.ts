import { z } from "zod";

import { AVATAR_PATHS, type AvatarPath } from "@/lib/domain/avatar-options";

const clean = (max: number) => z.string().trim().min(1).max(max);
const optionalClean = (max: number) => z.string().trim().max(max).nullable().optional();
const avatarUrl = z.string().max(1000).refine(
  (value) => AVATAR_PATHS.includes(value as AvatarPath) || z.url().safeParse(value).success,
  "Choose an available avatar or provide a valid absolute URL.",
);

export const taskCreateSchema = z.object({
  title: clean(160),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
}).strict();

export const taskUpdateSchema = z.object({
  title: clean(160).optional(),
  description: optionalClean(1000),
  category: optionalClean(48),
  dueAt: z.iso.datetime().nullable().optional(),
  recurrenceRule: z.enum(["daily", "weekdays", "weekly"]).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["pending", "completed"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const publishSchema = z.object({
  message: optionalClean(500),
  visibility: z.enum(["private", "public"]),
  recurrenceInstanceId: optionalClean(100),
  imagePaths: z.array(z.string().min(1).max(300)).max(4).optional(),
}).strict();

export const replySchema = z.object({
  content: clean(500),
  parentReplyId: z.uuid().nullable().optional(),
}).strict();

export const reactionSchema = z.object({ reaction: z.literal("like") }).strict();

export const progressPostSchema = z.object({
  content: clean(1200),
  visibility: z.enum(["private", "public"]).default("public"),
  idempotencyKey: clean(160),
  taskId: z.uuid().nullable().optional(),
  taskTitle: optionalClean(160),
  category: optionalClean(48),
}).strict();

export const profileSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/).optional(),
  displayName: optionalClean(50),
  bio: optionalClean(160),
  avatarUrl: avatarUrl.nullable().optional(),
  profileVisibility: z.enum(["private", "public"]).optional(),
  dailyGoal: z.number().int().min(1).max(50).optional(),
  interests: z.array(clean(48)).max(20).optional(),
  defaultTaskVisibility: z.enum(["private", "public"]).optional(),
  completionVisibility: z.enum(["private", "public"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const notificationReadSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100).optional(),
  all: z.boolean().optional(),
}).strict().refine((value) => value.all === true || Boolean(value.ids?.length), "Provide notification IDs or all=true.");

export const notificationPreferencesSchema = z.object({
  reactions: z.boolean().optional(),
  replies: z.boolean().optional(),
  companionActivity: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one preference is required.");

export const reportSchema = z.object({
  postId: z.uuid().optional(),
  replyId: z.uuid().optional(),
  reason: clean(300).refine((value) => value.length >= 3),
}).strict().refine((value) => Number(Boolean(value.postId)) + Number(Boolean(value.replyId)) === 1, "Report exactly one post or reply.");
