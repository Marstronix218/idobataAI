// Pure helpers for `npm run content:seed` (scripts/seed-characters.mjs):
// reading content folders, parsing options, the placeholder guard, and the
// plan that diffs the files against the rows already in the database.
// tests/domain/character-seed-plan.test.ts covers them without a database.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CHARACTER_FILES = { sheet: "sheet.json", lines: "lines.json", chapters: "chapters.json" };

/** Character folders under `root`, sorted. Skips schema/, dot folders and plain files such as README.md. */
export function listCharacterFolders(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "schema" && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The parsed JSON of one folder, shaped for lintCharacter(). A missing file is
 * `undefined` (the linter reports it); invalid JSON throws.
 * @returns {{ folder: string, sheet: unknown, lines: unknown, chapters: unknown }}
 */
export function readCharacterFolder(root, folder) {
  const contents = { folder, sheet: undefined, lines: undefined, chapters: undefined };
  for (const [key, file] of Object.entries(CHARACTER_FILES)) {
    const path = join(root, folder, file);
    if (!existsSync(path)) continue;
    try {
      contents[key] = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${folder}/${file} is not valid JSON: ${error.message}`);
    }
  }
  return contents;
}

/**
 * @param {string[]} args the arguments after `npm run content:seed --`
 * @returns {{ dryRun: boolean, only: string | null, allowPlaceholder: boolean }}
 */
export function parseSeedArgs(args) {
  const options = { dryRun: false, only: null, allowPlaceholder: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--allow-placeholder") {
      options.allowPlaceholder = true;
    } else if (arg === "--only" || arg.startsWith("--only=")) {
      const value = arg === "--only" ? args[(index += 1)] : arg.slice("--only=".length);
      if (!value || value.startsWith("--")) throw new Error("--only needs a character slug.");
      if (options.only) throw new Error("--only takes a single slug.");
      options.only = value;
    } else {
      throw new Error(`Unknown option "${arg}". Use --dry-run, --only <slug> and --allow-placeholder.`);
    }
  }
  return options;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export function isLocalSupabaseUrl(url) {
  const { hostname } = new URL(url);
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/**
 * Slugs of placeholder characters that must not be seeded: placeholder copy
 * only goes to a local stack unless --allow-placeholder is passed.
 * @param {Array<{ slug: string, placeholder: boolean }>} sheets
 */
export function blockedPlaceholderSlugs(sheets, url, allowPlaceholder) {
  if (allowPlaceholder || isLocalSupabaseUrl(url)) return [];
  return sheets.filter((sheet) => sheet.placeholder).map((sheet) => sheet.slug);
}

const CHARACTER_FIELDS = ["name", "role", "art_url", "is_launch", "pack_sku", "companion_id", "sheet", "active"];
const LINE_FIELDS = ["event", "text", "min_streak", "max_streak", "task_age_bucket", "tags", "active"];
const CHAPTER_FIELDS = ["title", "body", "unlock_rule", "active"];

/**
 * The `characters` row for a sheet. `sheet` keeps the whole sheet minus the
 * editor-only `$schema`. `active` follows the sheet (default true), so a
 * character is retired in content, not in SQL.
 */
export function characterRow(sheet, companionId) {
  const stored = { ...sheet };
  delete stored.$schema;
  return {
    slug: sheet.slug,
    name: sheet.name,
    role: sheet.role,
    art_url: sheet.art_url,
    is_launch: sheet.is_launch,
    pack_sku: sheet.pack_sku,
    companion_id: companionId,
    sheet: stored,
    active: sheet.active ?? true,
  };
}

export function lineRow(line) {
  return {
    id: line.id,
    event: line.event,
    text: line.text,
    min_streak: line.min_streak ?? null,
    max_streak: line.max_streak ?? null,
    task_age_bucket: line.task_age_bucket ?? null,
    tags: line.tags ?? [],
    active: line.active ?? true,
  };
}

export function chapterRow(chapter) {
  return { number: chapter.number, title: chapter.title, body: chapter.body, unlock_rule: chapter.unlock_rule, active: true };
}

/** JSON with sorted keys, so jsonb key order never counts as a change. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function differs(desired, existing, fields) {
  return fields.some((field) => canonical(desired[field]) !== canonical(existing[field]));
}

/**
 * @template Row, Key
 * @param {Row[]} desired
 * @param {Array<Record<string, unknown>>} existingRows
 * @param {(row: any) => Key} keyOf
 * @param {string[]} fields
 * @returns {{ insert: Row[], update: Row[], unchanged: number, deactivate: Key[] }}
 */
function diffRows(desired, existingRows, keyOf, fields) {
  const existingByKey = new Map(existingRows.map((row) => [keyOf(row), row]));
  const desiredKeys = new Set(desired.map(keyOf));
  const plan = { insert: [], update: [], unchanged: 0, deactivate: [] };
  for (const row of desired) {
    const current = existingByKey.get(keyOf(row));
    if (!current) plan.insert.push(row);
    else if (differs(row, current, fields)) plan.update.push(row);
    else plan.unchanged += 1;
  }
  // Rows that left the files are switched off, never deleted: reactions keep
  // pointing at old line ids.
  for (const row of existingRows) {
    if (row.active && !desiredKeys.has(keyOf(row))) plan.deactivate.push(keyOf(row));
  }
  return plan;
}

/**
 * Diffs one character's files against its database rows.
 * @param {{ sheet: object, lines: { lines: object[] }, chapters: { chapters: object[] } }} content linted file contents
 * @param {{ character: object | null, lines: object[], chapters: object[] }} existing current rows (empty for a new character)
 * @param {string | null} companionId social_companions.id for sheet.companion_slug, or null
 */
export function planCharacterSeed(content, existing, companionId) {
  const character = characterRow(content.sheet, companionId);
  let action = "insert";
  if (existing.character) action = differs(character, existing.character, CHARACTER_FIELDS) ? "update" : "unchanged";
  return {
    slug: content.sheet.slug,
    characterId: existing.character?.id ?? null,
    character: { action, row: character },
    lines: diffRows(content.lines.lines.map(lineRow), existing.lines, (row) => row.id, LINE_FIELDS),
    chapters: diffRows(content.chapters.chapters.map(chapterRow), existing.chapters, (row) => row.number, CHAPTER_FIELDS),
  };
}

/**
 * Slugs of active characters in the database that no longer have a content
 * folder. A full seed (no --only) sets them inactive; it never deletes them.
 * @param {string[]} folderSlugs every character folder's slug
 * @param {Array<{ slug: string, active: boolean }>} existingCharacters every characters row
 */
export function planCharacterRetirements(folderSlugs, existingCharacters) {
  const kept = new Set(folderSlugs);
  return existingCharacters
    .filter((character) => character.active && !kept.has(character.slug))
    .map((character) => character.slug)
    .sort();
}

export function planHasWrites(plan) {
  return plan.character.action !== "unchanged"
    || [plan.lines, plan.chapters].some((group) => group.insert.length || group.update.length || group.deactivate.length);
}

/** Human-readable lines for one plan; `detailed` also lists every changed id. */
export function describePlan(plan, { detailed = false } = {}) {
  const count = (group) => `${group.insert.length} new, ${group.update.length} changed, ${group.unchanged} unchanged, ${group.deactivate.length} to deactivate`;
  const output = [
    `${plan.slug}: character ${plan.character.action}`,
    `  lines: ${count(plan.lines)}`,
    `  chapters: ${count(plan.chapters)}`,
  ];
  const list = (label, keys) => {
    if (keys.length) output.push(`    ${label}: ${keys.join(", ")}`);
  };
  if (detailed) {
    list("new lines", plan.lines.insert.map((row) => row.id));
    list("changed lines", plan.lines.update.map((row) => row.id));
    list("new chapters", plan.chapters.insert.map((row) => row.number));
    list("changed chapters", plan.chapters.update.map((row) => row.number));
  }
  list("deactivate lines", plan.lines.deactivate);
  list("deactivate chapters", plan.chapters.deactivate);
  return output;
}
