// The content format for content/characters/<slug>/{sheet,lines,chapters}.json.
// Limits mirror the CHECK constraints in
// supabase/migrations/20261031120100_pivot_a_core_schema.sql, so anything that
// parses here can be seeded. `npm run content:schema` writes
// content/characters/schema/*.schema.json from these definitions, and
// tests/domain/character-schema-sync.test.ts fails if they drift.
//
// scripts/seed-characters.mjs loads this file with plain Node (type stripping),
// so keep imports relative (no `@/` alias) and use only erasable TypeScript.

import { z } from "zod";

export const CHARACTER_ROLES = ["coach", "rival", "cheerleader", "deadpan"] as const;

export const CHARACTER_EVENTS = [
  "task_started",
  "task_finished",
  "first_of_day",
  "streak",
  "comeback",
  "session_nudge",
  "split_intro",
  "chapter_unlocked",
] as const;

/** fresh < 1 day, days 1-6, weeks 7-29, stale >= 30. A line without one matches any age. */
export const TASK_AGE_BUCKETS = ["fresh", "days", "weeks", "stale"] as const;

/** The only token a line may contain. The reaction engine replaces it with the task title. */
export const TASK_TOKEN = "{task}";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `<slug>.<event>.<nnn>`, e.g. `sample-coach.task_started.001`. */
export const LINE_ID_PATTERN = new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*\\.(?:${CHARACTER_EVENTS.join("|")})\\.[0-9]{3}$`);

const PG_INT_MAX = 2_147_483_647;

/** Non-blank text of at most `max` characters. */
function text(max: number) {
  return z.string().min(1).max(max).regex(/\S/, "must not be blank");
}

const slug = z
  .string()
  .max(48)
  .regex(SLUG_PATTERN, "must be lowercase letters and digits separated by single hyphens")
  .meta({ description: "Lowercase letters and digits separated by single hyphens; must match the folder name." });

/** Lets a content file point editors at its JSON Schema. Ignored by the seed. */
const schemaRef = z.string().optional().meta({ description: "Optional path to this file's JSON Schema, for editors." });

export const characterSheetSchema = z
  .strictObject({
    $schema: schemaRef,
    slug,
    name: text(60),
    role: z.enum(CHARACTER_ROLES),
    placeholder: z.boolean().meta({ description: "True while the copy is a stand-in. Must match lines.json and chapters.json." }),
    voice_notes: text(2000).meta({ description: "How the character sounds; fills {voice_notes} in the AI system prompt." }),
    do: z.array(text(200)).min(1).max(50),
    dont: z.array(text(200)).min(1).max(50),
    sample_lines: z
      .array(text(400))
      .min(1)
      .max(50)
      .meta({ description: "Example reactions for the AI prompt. May use {task}." }),
    art_url: text(2048).nullable(),
    is_launch: z.boolean(),
    pack_sku: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,100}$/, "must be 1-100 letters, digits or . _ : -")
      .nullable()
      .meta({ description: "Store product id for this character's pack, or null." }),
    companion_slug: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/, "must be an existing social_companions slug")
      .nullable()
      .meta({ description: "Existing persona whose art this character reuses, or null." }),
    active: z
      .boolean()
      .optional()
      .meta({ description: "Defaults to true. Set false to retire the character: the seed sets it inactive and keeps its rows." }),
  })
  .meta({ title: "Character sheet" });

const streak = z.int().min(0).max(PG_INT_MAX);

export const characterLineSchema = z
  .strictObject({
    id: z
      .string()
      .max(120)
      .regex(LINE_ID_PATTERN, "must look like <slug>.<event>.<nnn>")
      .meta({ description: "Stable id <slug>.<event>.<nnn>. Never reuse an id for different copy." }),
    event: z.enum(CHARACTER_EVENTS),
    text: text(400).meta({ description: "Under 40 words. May use {task}; no other tokens." }),
    min_streak: streak.optional(),
    max_streak: streak.optional(),
    task_age_bucket: z.enum(TASK_AGE_BUCKETS).optional(),
    tags: z.array(z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "must be a lowercase tag").max(40)).max(20).optional(),
    active: z.boolean().optional().meta({ description: "Defaults to true. Set false to retire a line and keep its id reserved." }),
  })
  .refine((line) => line.min_streak === undefined || line.max_streak === undefined || line.max_streak >= line.min_streak, {
    message: "max_streak must be greater than or equal to min_streak",
    path: ["max_streak"],
  });

export const characterLinesFileSchema = z
  .strictObject({
    $schema: schemaRef,
    placeholder: z.boolean(),
    lines: z.array(characterLineSchema).min(1),
  })
  .meta({ title: "Character lines" });

const chapterNumber = z.int().min(1).max(PG_INT_MAX);

export const storyChapterSchema = z.strictObject({
  number: chapterNumber.meta({ description: "1..n with no gaps, in file order." }),
  title: text(120),
  body: text(20000),
  unlock_rule: z
    .strictObject({ consistency_days: chapterNumber })
    .meta({ description: "Chapter n unlocks at n consistency days, so consistency_days must equal number." }),
});

export const storyChaptersFileSchema = z
  .strictObject({
    $schema: schemaRef,
    placeholder: z.boolean(),
    chapters: z.array(storyChapterSchema).min(1),
  })
  .meta({ title: "Story chapters" });

export type CharacterRole = (typeof CHARACTER_ROLES)[number];
export type CharacterEvent = (typeof CHARACTER_EVENTS)[number];
export type TaskAgeBucket = (typeof TASK_AGE_BUCKETS)[number];
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
export type CharacterLine = z.infer<typeof characterLineSchema>;
export type CharacterLinesFile = z.infer<typeof characterLinesFileSchema>;
export type StoryChapter = z.infer<typeof storyChapterSchema>;
export type StoryChaptersFile = z.infer<typeof storyChaptersFileSchema>;

export const CHARACTER_FILE_SCHEMAS = {
  sheet: characterSheetSchema,
  lines: characterLinesFileSchema,
  chapters: storyChaptersFileSchema,
} as const;

export type CharacterFileKind = keyof typeof CHARACTER_FILE_SCHEMAS;

/** The exact text of content/characters/schema/<kind>.schema.json. */
export function renderCharacterJsonSchemas(): Record<CharacterFileKind, string> {
  return {
    sheet: `${JSON.stringify(z.toJSONSchema(characterSheetSchema), null, 2)}\n`,
    lines: `${JSON.stringify(z.toJSONSchema(characterLinesFileSchema), null, 2)}\n`,
    chapters: `${JSON.stringify(z.toJSONSchema(storyChaptersFileSchema), null, 2)}\n`,
  };
}
