#!/usr/bin/env node

// `npm run content:seed` loads content/characters/<slug>/ into characters,
// character_lines and story_chapters for whichever Supabase project the
// credentials point at. It is idempotent: characters upsert by slug, lines by
// id, chapters by (character, number); only changed rows are written. Lines and
// chapters that left the files are set inactive, and so are characters whose
// folder is gone (full runs only). Nothing is ever deleted.
//
//   npm run content:seed -- --dry-run            print the plan, write nothing
//   npm run content:seed -- --only <slug>        one character (and no retirements)
//   npm run content:seed -- --allow-placeholder  let placeholder copy reach a non-local project
//
// Every character is linted with the same linter the tests run
// (src/lib/characters/lint.ts), and nothing is written if any has an issue.

import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  blockedPlaceholderSlugs,
  describePlan,
  listCharacterFolders,
  parseSeedArgs,
  planCharacterRetirements,
  planCharacterSeed,
  planHasWrites,
  readCharacterFolder,
} from "./lib/character-seed.mjs";

register("./lib/typescript-hooks.mjs", import.meta.url);
const { formatLintIssue, lintCharacter } = await import("../src/lib/characters/lint.ts");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = resolve(projectRoot, "content/characters");
const PAGE_SIZE = 1000;

// Same parsing as scripts/flags.mjs.
function readEnvFile(path) {
  if (!existsSync(path)) return new Map();

  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function fail(message, code = 1) {
  console.error(`content:seed: ${message}`);
  process.exit(code);
}

let options;
try {
  options = parseSeedArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}

// 1. Read and lint before touching the network.
let folders = listCharacterFolders(contentRoot);
if (options.only) {
  if (!folders.includes(options.only)) fail(`no character folder named "${options.only}" in content/characters.`);
  folders = [options.only];
}
const characters = [];
let issueCount = 0;
for (const folder of folders) {
  let contents;
  try {
    contents = readCharacterFolder(contentRoot, folder);
  } catch (error) {
    fail(error.message);
  }
  const issues = lintCharacter(contents);
  for (const issue of issues) console.error(`  ${formatLintIssue(folder, issue)}`);
  issueCount += issues.length;
  characters.push(contents);
}
if (issueCount) fail(`${issueCount} lint issue(s); nothing was written.`);

// 2. Target project.
const fileEnv = readEnvFile(resolve(projectRoot, ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is missing from the environment and .env.local.");
if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY is missing from the environment and .env.local.");

let host;
try {
  host = new URL(url).host;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}
console.log(`${options.dryRun ? "Planning" : "Seeding"} ${characters.length} character(s) on ${host}${options.dryRun ? " (dry run, nothing is written)" : ""}.`);

const blocked = blockedPlaceholderSlugs(characters.map((character) => character.sheet), url, options.allowPlaceholder);
if (blocked.length) {
  fail(`${blocked.join(", ")} still ${blocked.length === 1 ? "has" : "have"} placeholder copy and ${host} is not a local stack. Pass --allow-placeholder to seed it anyway.`);
}

const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function selectAll(table, columns, characterId, orderBy) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("character_id", characterId)
      .order(orderBy)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`could not read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function selectAllCharacters() {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from("characters").select("slug, active").order("slug").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`could not read characters: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function readExisting(slug) {
  const { data: character, error } = await supabase
    .from("characters")
    .select("id, name, role, art_url, is_launch, pack_sku, companion_id, sheet, active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`could not read character ${slug}: ${error.message}`);
  if (!character) return { character: null, lines: [], chapters: [] };
  return {
    character,
    lines: await selectAll("character_lines", "id, event, text, min_streak, max_streak, task_age_bucket, tags, active", character.id, "id"),
    chapters: await selectAll("story_chapters", "number, title, body, unlock_rule, active", character.id, "number"),
  };
}

async function companionIdFor(sheet) {
  if (!sheet.companion_slug) return null;
  const { data, error } = await supabase.from("social_companions").select("id").eq("slug", sheet.companion_slug).maybeSingle();
  if (error) throw new Error(`could not look up companion ${sheet.companion_slug}: ${error.message}`);
  if (!data) console.warn(`  ${sheet.slug}: no social_companions row with slug "${sheet.companion_slug}"; companion_id stays null.`);
  return data?.id ?? null;
}

async function applyPlan(plan) {
  let characterId = plan.characterId;
  if (plan.character.action !== "unchanged") {
    const { data, error } = await supabase.from("characters").upsert(plan.character.row, { onConflict: "slug" }).select("id").single();
    if (error) throw new Error(`could not write character ${plan.slug}: ${error.message}`);
    characterId = data.id;
  }

  const lines = [...plan.lines.insert, ...plan.lines.update].map((row) => ({ ...row, character_id: characterId }));
  if (lines.length) {
    const { error } = await supabase.from("character_lines").upsert(lines, { onConflict: "id" });
    if (error) throw new Error(`could not write lines for ${plan.slug}: ${error.message}`);
  }
  if (plan.lines.deactivate.length) {
    const { error } = await supabase
      .from("character_lines")
      .update({ active: false })
      .eq("character_id", characterId)
      .in("id", plan.lines.deactivate);
    if (error) throw new Error(`could not deactivate lines for ${plan.slug}: ${error.message}`);
  }

  const chapters = [...plan.chapters.insert, ...plan.chapters.update].map((row) => ({ ...row, character_id: characterId }));
  if (chapters.length) {
    const { error } = await supabase.from("story_chapters").upsert(chapters, { onConflict: "character_id,number" });
    if (error) throw new Error(`could not write chapters for ${plan.slug}: ${error.message}`);
  }
  if (plan.chapters.deactivate.length) {
    const { error } = await supabase
      .from("story_chapters")
      .update({ active: false })
      .eq("character_id", characterId)
      .in("number", plan.chapters.deactivate);
    if (error) throw new Error(`could not deactivate chapters for ${plan.slug}: ${error.message}`);
  }
}

// 3. Plan and apply, one character at a time. There is no transaction across
// requests; if a run stops part-way, running it again finishes the job.
try {
  let writes = 0;
  for (const { sheet, lines, chapters } of characters) {
    const plan = planCharacterSeed({ sheet, lines, chapters }, await readExisting(sheet.slug), await companionIdFor(sheet));
    for (const line of describePlan(plan, { detailed: options.dryRun })) console.log(line);
    if (!planHasWrites(plan)) continue;
    writes += 1;
    if (!options.dryRun) await applyPlan(plan);
  }

  // A full run also retires characters whose folder was removed.
  if (!options.only) {
    const retire = planCharacterRetirements(characters.map((character) => character.sheet.slug), await selectAllCharacters());
    if (retire.length) {
      console.log(`Retire (no content folder, set inactive): ${retire.join(", ")}`);
      writes += retire.length;
      if (!options.dryRun) {
        const { error } = await supabase.from("characters").update({ active: false }).in("slug", retire);
        if (error) throw new Error(`could not retire characters: ${error.message}`);
      }
    }
  }
  if (options.dryRun) console.log(writes ? `Dry run: ${writes} character(s) would change.` : "Dry run: everything is up to date.");
  else console.log(writes ? `Done: ${writes} character(s) updated.` : "Done: everything was already up to date.");
} catch (error) {
  fail(error.message);
}
