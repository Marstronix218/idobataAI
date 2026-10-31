// The content linter for content/characters/<slug>/. tests/domain/character-content.test.ts
// runs it on every folder, and scripts/seed-characters.mjs refuses to seed a
// character with any issue.
//
// Loaded by the seed script with plain Node (type stripping): relative imports
// only, and only erasable TypeScript.

import type { ZodType } from "zod";
import { findBannedContent } from "./banned-content";
import {
  CHARACTER_EVENTS,
  TASK_TOKEN,
  characterLinesFileSchema,
  characterSheetSchema,
  storyChaptersFileSchema,
  type CharacterEvent,
} from "./content-schema";

/** A line or sample line must have fewer words than this; `{task}` counts as one word. */
export const LINE_WORD_LIMIT = 40;

export type CharacterFile = "sheet.json" | "lines.json" | "chapters.json";

export type LintRule =
  | "schema"
  | "slug_folder"
  | "missing_event"
  | "word_count"
  | "banned_content"
  | "unknown_token"
  | "line_id"
  | "duplicate_id"
  | "chapter_numbering"
  | "unlock_rule"
  | "placeholder_mismatch"
  | "placeholder_marker";

export interface LintIssue {
  rule: LintRule;
  file: CharacterFile;
  /** Dotted path inside the file, e.g. `lines.3.text`; empty for the whole file. */
  path: string;
  message: string;
}

/** The parsed JSON of one folder; a missing file is `undefined`. */
export interface CharacterFolderContents {
  folder: string;
  sheet: unknown;
  lines: unknown;
  chapters: unknown;
}

const PLACEHOLDER_MARKER = /[[(]placeholder[\])]/i;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Every `{...}` token, or stray brace, in `text` other than the allowed tokens. */
export function findUnknownTokens(text: string, allowed: readonly string[]): string[] {
  let rest = text;
  for (const token of allowed) rest = rest.split(token).join(" ");
  return rest.match(/\{[^{}]*\}|[{}]/g) ?? [];
}

export function formatLintIssue(folder: string, issue: LintIssue): string {
  return `${folder}/${issue.file}${issue.path ? ` ${issue.path}` : ""}: ${issue.message} [${issue.rule}]`;
}

export function lintCharacter({ folder, sheet, lines, chapters }: CharacterFolderContents): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: LintRule, file: CharacterFile, path: string, message: string) => issues.push({ rule, file, path, message });

  function parse<T>(file: CharacterFile, schema: ZodType<T>, value: unknown): T | null {
    if (value === undefined) {
      add("schema", file, "", "file is missing");
      return null;
    }
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) add("schema", file, issue.path.map(String).join("."), issue.message);
    return null;
  }

  /**
   * Banned content, tokens and leftover placeholder markers in one piece of
   * copy. `tokens: null` skips the token check (prompt notes, not shown copy).
   */
  function checkCopy(file: CharacterFile, path: string, text: string, options: { tokens: readonly string[] | null; placeholder: boolean }) {
    for (const match of findBannedContent(text)) add("banned_content", file, path, `banned ${match.category} phrase "${match.phrase}"`);
    const { tokens } = options;
    if (tokens) {
      const allowed = tokens.length ? `only ${tokens.join(", ")} is allowed` : "no tokens are allowed here";
      for (const token of findUnknownTokens(text, tokens)) add("unknown_token", file, path, `unknown token "${token}"; ${allowed}`);
    }
    if (!options.placeholder && PLACEHOLDER_MARKER.test(text)) {
      add("placeholder_marker", file, path, "placeholder marker left in copy, but the file says placeholder: false");
    }
  }

  function checkWordCount(file: CharacterFile, path: string, text: string) {
    const words = countWords(text);
    if (words >= LINE_WORD_LIMIT) add("word_count", file, path, `${words} words; lines must be under ${LINE_WORD_LIMIT}`);
  }

  const parsedSheet = parse("sheet.json", characterSheetSchema, sheet);
  const parsedLines = parse("lines.json", characterLinesFileSchema, lines);
  const parsedChapters = parse("chapters.json", storyChaptersFileSchema, chapters);

  if (parsedSheet) {
    if (parsedSheet.slug !== folder) add("slug_folder", "sheet.json", "slug", `slug "${parsedSheet.slug}" must match the folder name "${folder}"`);
    if (!parsedSheet.placeholder && PLACEHOLDER_MARKER.test(parsedSheet.name)) {
      add("placeholder_marker", "sheet.json", "name", "placeholder marker left in the name, but the file says placeholder: false");
    }
    // `dont` is not checked: it has to name the banned things.
    checkCopy("sheet.json", "voice_notes", parsedSheet.voice_notes, { tokens: null, placeholder: parsedSheet.placeholder });
    parsedSheet.do.forEach((text, index) => checkCopy("sheet.json", `do.${index}`, text, { tokens: null, placeholder: parsedSheet.placeholder }));
    parsedSheet.sample_lines.forEach((text, index) => {
      checkWordCount("sheet.json", `sample_lines.${index}`, text);
      checkCopy("sheet.json", `sample_lines.${index}`, text, { tokens: [TASK_TOKEN], placeholder: parsedSheet.placeholder });
    });
  }

  if (parsedLines) {
    const slug = parsedSheet?.slug ?? folder;
    const ids = new Set<string>();
    const covered = new Set<CharacterEvent>();
    parsedLines.lines.forEach((line, index) => {
      const path = `lines.${index}`;
      if (ids.has(line.id)) add("duplicate_id", "lines.json", `${path}.id`, `duplicate line id "${line.id}"`);
      ids.add(line.id);

      const [idSlug, idEvent] = line.id.split(".");
      if (idSlug !== slug) add("line_id", "lines.json", `${path}.id`, `line id "${line.id}" must start with "${slug}."`);
      if (idEvent !== line.event) add("line_id", "lines.json", `${path}.id`, `line id "${line.id}" names event "${idEvent}" but the line's event is "${line.event}"`);

      checkWordCount("lines.json", `${path}.text`, line.text);
      checkCopy("lines.json", `${path}.text`, line.text, { tokens: [TASK_TOKEN], placeholder: parsedLines.placeholder });

      if (line.active !== false) covered.add(line.event);
    });
    for (const event of CHARACTER_EVENTS) {
      if (!covered.has(event)) add("missing_event", "lines.json", "lines", `no active line for required event "${event}"`);
    }
  }

  if (parsedChapters) {
    parsedChapters.chapters.forEach((chapter, index) => {
      const path = `chapters.${index}`;
      if (chapter.number !== index + 1) {
        add("chapter_numbering", "chapters.json", `${path}.number`, `chapters must be numbered 1..n in order: expected ${index + 1}, found ${chapter.number}`);
      }
      if (chapter.unlock_rule.consistency_days !== chapter.number) {
        add("unlock_rule", "chapters.json", `${path}.unlock_rule.consistency_days`, `chapter ${chapter.number} must unlock at ${chapter.number} consistency days, not ${chapter.unlock_rule.consistency_days}`);
      }
      checkCopy("chapters.json", `${path}.title`, chapter.title, { tokens: [], placeholder: parsedChapters.placeholder });
      checkCopy("chapters.json", `${path}.body`, chapter.body, { tokens: [], placeholder: parsedChapters.placeholder });
    });
  }

  if (parsedSheet && parsedLines && parsedLines.placeholder !== parsedSheet.placeholder) {
    add("placeholder_mismatch", "lines.json", "placeholder", `placeholder is ${parsedLines.placeholder} but sheet.json says ${parsedSheet.placeholder}`);
  }
  if (parsedSheet && parsedChapters && parsedChapters.placeholder !== parsedSheet.placeholder) {
    add("placeholder_mismatch", "chapters.json", "placeholder", `placeholder is ${parsedChapters.placeholder} but sheet.json says ${parsedSheet.placeholder}`);
  }

  return issues;
}
