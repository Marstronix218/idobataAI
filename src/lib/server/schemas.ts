import { z } from "zod";
import { COMPLETION_COMMENT_MAX_CHARACTERS, taskCreateSchema, taskUpdateSchema } from "@idobata/contracts";

export { taskCreateSchema, taskUpdateSchema };

import { AVATAR_PATHS, type AvatarPath } from "@/lib/domain/avatar-options";

const clean = (max: number) => z.string().trim().min(1).max(max);
const optionalClean = (max: number) => z.string().trim().max(max).nullable().optional();
// `z.url()` accepts any scheme and any host, so an arbitrary remote URL used to
// be storable here and was then rendered as an <img> in the feed, chat, replies
// and profile pages. That handed the URL's owner the IP address, User-Agent and
// Referer of every viewer -- silent cross-user deanonymisation inside a product
// that promises private profiles. Avatars are now restricted to the bundled
// options and this project's own Supabase storage origin.
const supabaseStorageOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

function isOwnStorageUrl(value: string) {
  if (!supabaseStorageOrigin) return false;
  try {
    const url = new URL(value);
    return url.origin === supabaseStorageOrigin
      && url.pathname.startsWith("/storage/v1/object/public/avatars/");
  } catch {
    return false;
  }
}

const avatarUrl = z.string().max(1000).refine(
  (value) => AVATAR_PATHS.includes(value as AvatarPath) || isOwnStorageUrl(value),
  "Choose an available avatar or upload a photo.",
);

export const taskCategorySchema = z.object({
  name: clean(48),
}).strict();

export const publishSchema = z.object({
  message: optionalClean(COMPLETION_COMMENT_MAX_CHARACTERS),
  visibility: z.enum(["private", "public"]),
  recurrenceInstanceId: optionalClean(100),
  imagePaths: z.array(z.string().min(1).max(300)).max(4).optional(),
}).strict();

export const replySchema = z.object({
  content: clean(500),
  parentReplyId: z.uuid().nullable().optional(),
}).strict();

export const reactionSchema = z.object({ reaction: z.literal("like") }).strict();

export const quoteRepostSchema = z.object({
  content: clean(500),
  visibility: z.enum(["private", "public"]),
  idempotencyKey: clean(160),
}).strict();

export const postUpdateSchema = z.object({
  visibility: z.enum(["private", "public"]),
}).strict();

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
}).strict().refine((value) => Object.keys(value).length > 0, "At least one preference is required.");

export const reportSchema = z.object({
  postId: z.uuid().optional(),
  replyId: z.uuid().optional(),
  reason: clean(300).refine((value) => value.length >= 3),
}).strict().refine((value) => Number(Boolean(value.postId)) + Number(Boolean(value.replyId)) === 1, "Report exactly one post or reply.");

export const feedbackSchema = z.object({
  category: z.enum(["idea", "issue", "other"]),
  message: z.string().trim().min(5).max(2000),
}).strict();
